import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import csv from "csv-parser";
import { Readable } from "stream";

const upload = multer();

// Helper to calculate standard deviation
function getStandardDeviation(array: number[], mean: number) {
  const n = array.length;
  if (n <= 1) return 0;
  const variance = array.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
  return Math.sqrt(variance);
}

// Helper to calculate percentiles
function getPercentile(sortedArray: number[], percentile: number) {
  if (sortedArray.length === 0) return 0;
  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (upper >= sortedArray.length) return sortedArray[lower];
  return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
}

function getAlignedNumericValues(results: any[], col1: string, col2: string) {
  const x: number[] = [];
  const y: number[] = [];
  results.forEach(row => {
    const val1 = Number(row[col1]);
    const val2 = Number(row[col2]);
    if (!isNaN(val1) && !isNaN(val2) && row[col1] !== null && row[col1] !== "" && row[col2] !== null && row[col2] !== "") {
      x.push(val1);
      y.push(val2);
    }
  });
  return { x, y };
}

function calculateCorrelation(x: number[], y: number[]) {
  const n = x.length;
  if (n === 0 || n !== y.length) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function analyzeData(results: any[]) {
  if (results.length === 0) return null;

  const columns = Object.keys(results[0]);
  const stats: Record<string, any> = {};
  const numericColumns: string[] = [];
  let totalMissing = 0;

  columns.forEach((col) => {
    const rawValues = results.map((row) => row[col]);
    const missingCount = rawValues.filter((v) => v === null || v === undefined || v === "").length;
    totalMissing += missingCount;
    const values = rawValues.filter((v) => v !== null && v !== undefined && v !== "");
    
    // Try to parse as numbers
    const numericValues = values.map(Number).filter((v) => !isNaN(v));

    if (numericValues.length > values.length * 0.5 && numericValues.length > 0) {
      // Treat as numeric
      numericColumns.push(col);
      const originalNumericValues = [...numericValues]; // keep original order for line chart
      numericValues.sort((a, b) => a - b);
      const sum = numericValues.reduce((a, b) => a + b, 0);
      const min = numericValues[0];
      const max = numericValues[numericValues.length - 1];
      const mean = sum / numericValues.length;
      const std = getStandardDeviation(numericValues, mean);
      const p25 = getPercentile(numericValues, 25);
      const p50 = getPercentile(numericValues, 50); // median
      const p75 = getPercentile(numericValues, 75);
      
      // Calculate distribution (histogram)
      const binCount = 10;
      const binSize = (max - min) / binCount || 1; // avoid division by zero
      const distribution = Array.from({ length: binCount }, (_, i) => {
        const binMin = min + i * binSize;
        const binMax = i === binCount - 1 ? max : min + (i + 1) * binSize;
        return {
          range: `${binMin.toFixed(2)} - ${binMax.toFixed(2)}`,
          count: 0,
          min: binMin,
          max: binMax
        };
      });

      numericValues.forEach(val => {
        for (let i = 0; i < binCount; i++) {
          if (val >= distribution[i].min && (i === binCount - 1 ? val <= distribution[i].max : val < distribution[i].max)) {
            distribution[i].count++;
            break;
          }
        }
      });

      // Sample data for line chart (max 100 points to avoid huge payloads)
      const step = Math.max(1, Math.floor(originalNumericValues.length / 100));
      const sample = originalNumericValues.filter((_, i) => i % step === 0).slice(0, 100).map((val, idx) => ({ index: idx * step, value: val }));

      stats[col] = {
        type: "numeric",
        count: numericValues.length,
        missing: missingCount,
        mean,
        std,
        min,
        p25,
        p50,
        p75,
        max,
        distribution,
        sample
      };
    } else {
      // Treat as categorical
      const counts: Record<string, number> = {};
      values.forEach((v) => {
        const strVal = String(v);
        counts[strVal] = (counts[strVal] || 0) + 1;
      });

      const uniqueCount = Object.keys(counts).length;
      const distribution = Object.entries(counts)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
      
      const top = distribution.length > 0 ? distribution[0].value : null;
      const freq = distribution.length > 0 ? distribution[0].count : 0;

      stats[col] = {
        type: "categorical",
        count: values.length,
        missing: missingCount,
        unique: uniqueCount,
        top,
        freq,
        distribution: distribution.slice(0, 10) // Top 10 categories for chart
      };
    }
  });

  const correlationMatrix: Record<string, Record<string, number>> = {};
  numericColumns.forEach(col1 => {
    correlationMatrix[col1] = {};
    numericColumns.forEach(col2 => {
      if (col1 === col2) {
        correlationMatrix[col1][col2] = 1;
      } else {
        const { x, y } = getAlignedNumericValues(results, col1, col2);
        correlationMatrix[col1][col2] = calculateCorrelation(x, y);
      }
    });
  });

  const totalCells = results.length * columns.length;
  const missingPercentage = totalCells > 0 ? (totalMissing / totalCells) * 100 : 0;

  return {
    rowCount: results.length,
    columnCount: columns.length,
    columns,
    numericColumns,
    totalMissing,
    missingPercentage,
    correlationMatrix,
    stats,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/upload", upload.single("dataset"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filename = req.file.originalname.toLowerCase();
    const results: any[] = [];

    if (filename.endsWith(".json")) {
      try {
        const jsonStr = req.file.buffer.toString('utf8');
        const parsed = JSON.parse(jsonStr);
        
        // Handle both array of objects and object with arrays
        let dataToAnalyze = [];
        if (Array.isArray(parsed)) {
          dataToAnalyze = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
          // If it's an object of arrays (like pandas to_json), convert to array of objects
          const keys = Object.keys(parsed);
          if (keys.length > 0 && Array.isArray(parsed[keys[0]] || typeof parsed[keys[0]] === 'object')) {
             const firstKey = keys[0];
             const isArray = Array.isArray(parsed[firstKey]);
             const length = isArray ? parsed[firstKey].length : Object.keys(parsed[firstKey]).length;
             
             for (let i = 0; i < length; i++) {
               const row: any = {};
               keys.forEach(k => {
                 row[k] = isArray ? parsed[k][i] : parsed[k][Object.keys(parsed[k])[i]];
               });
               dataToAnalyze.push(row);
             }
          } else {
            dataToAnalyze = [parsed];
          }
        }

        const analysis = analyzeData(dataToAnalyze);
        if (!analysis) {
          return res.status(400).json({ error: "Empty or invalid JSON dataset" });
        }
        return res.json(analysis);
      } catch (e) {
        console.error("JSON parsing error:", e);
        return res.status(400).json({ error: "Invalid JSON file" });
      }
    } else if (filename.endsWith(".csv")) {
      const stream = Readable.from(req.file.buffer);
      stream
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("end", () => {
          const analysis = analyzeData(results);
          if (!analysis) {
            return res.status(400).json({ error: "Empty or invalid CSV file" });
          }
          res.json(analysis);
        })
        .on("error", (error) => {
          console.error("CSV parsing error:", error);
          res.status(500).json({ error: "Failed to parse CSV file" });
        });
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload CSV or JSON." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from dist in production
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    app.use(express.static(path.join(__dirname, "dist")));
    
    // Fallback to index.html for SPA routing
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
