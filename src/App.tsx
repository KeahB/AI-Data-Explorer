import { Upload, FileType, BarChart3, Info, AlertCircle, Table as TableIcon, LayoutDashboard, Database, Columns, AlertTriangle, ChevronRight, Sparkles, Loader2 } from "lucide-react";
import React, { useState, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, ScatterChart, Scatter } from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";
import Markdown from "react-markdown";

interface DatasetStats {
  rowCount: number;
  columnCount: number;
  columns: string[];
  numericColumns: string[];
  totalMissing: number;
  missingPercentage: number;
  correlationMatrix: Record<string, Record<string, number>>;
  stats: Record<string, any>;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DatasetStats | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<Record<string, string>>({});
  const [generatingInsight, setGeneratingInsight] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateInsight = async (contextKey: string, contextName: string, statsData: any) => {
    setGeneratingInsight(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let payload = statsData;
      if (contextKey === "overview") {
        payload = {
          rowCount: statsData.rowCount,
          columnCount: statsData.columnCount,
          numericColumns: statsData.numericColumns,
          totalMissing: statsData.totalMissing,
          missingPercentage: statsData.missingPercentage,
          topCorrelations: Object.entries(statsData.correlationMatrix || {}).flatMap(([col1, targets]: [string, any]) => 
            Object.entries(targets).filter(([col2, val]: [string, any]) => col1 !== col2 && Math.abs(val as number) > 0.5).map(([col2, val]) => ({ pair: `${col1} & ${col2}`, value: val }))
          ).slice(0, 10)
        };
      } else {
        const { sample, ...restStats } = statsData;
        payload = restStats;
      }

      const prompt = `You are an expert data analyst. Provide a concise, insightful analysis of the following dataset statistics for "${contextName}". 
      Focus on interesting patterns, potential data quality issues, outliers, and what the data might represent. 
      Keep it under 3 paragraphs. Format your response in Markdown.
      
      Data Statistics:
      ${JSON.stringify(payload, null, 2)}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });
      
      setAiInsights(prev => ({ ...prev, [contextKey]: response.text || "No insights generated." }));
    } catch (err) {
      console.error("Failed to generate insight:", err);
      setAiInsights(prev => ({ ...prev, [contextKey]: "Failed to generate insights. Please try again." }));
    } finally {
      setGeneratingInsight(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith(".csv") || droppedFile.name.endsWith(".json")) {
        setFile(droppedFile);
        setError(null);
      } else {
        setError("Please upload a valid CSV or JSON file.");
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);
    setAiInsights({});

    const formData = new FormData();
    formData.append("dataset", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload dataset");
      }

      const result = await response.json();
      setData(result);
      setSelectedColumn("overview");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderCorrelationMatrix = () => {
    if (!data || !data.numericColumns || data.numericColumns.length === 0) return null;
    
    const cols = data.numericColumns;
    
    return (
      <div className="overflow-x-auto pb-4 custom-scrollbar">
        <table className="min-w-full text-xs text-center border-collapse">
          <thead>
            <tr>
              <th className="p-3 border-b border-slate-200 bg-transparent"></th>
              {cols.map(col => (
                <th key={col} className="p-3 border-b border-slate-200 bg-transparent text-slate-500 font-medium truncate max-w-[100px]" title={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map(rowCol => (
              <tr key={rowCol}>
                <th className="p-3 border-b border-slate-100 bg-transparent text-left text-slate-500 font-medium truncate max-w-[100px]" title={rowCol}>{rowCol}</th>
                {cols.map(col => {
                  const val = data.correlationMatrix[rowCol][col];
                  const isPositive = val > 0;
                  const intensity = Math.abs(val);
                  const bgColor = isPositive 
                    ? `rgba(220, 38, 38, ${intensity * 0.8})` 
                    : `rgba(59, 130, 246, ${intensity * 0.8})`; 
                  const textColor = intensity > 0.6 ? 'white' : '#94a3b8';
                  
                  return (
                    <td key={col} className="p-3 border border-[#1f2937]" style={{ backgroundColor: bgColor, color: textColor, borderRadius: '4px' }}>
                      {val.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderBoxPlot = (colStats: any) => {
    const { min, p25, p50, p75, max } = colStats;
    const range = max - min || 1;
    const getPercent = (val: number) => ((val - min) / range) * 100;
    
    return (
      <div className="h-80 w-full flex justify-center mt-6 mb-4">
        <div className="h-full w-32 relative py-8">
          {/* Central line */}
          <div className="absolute left-1/2 top-8 bottom-8 w-0.5 bg-[#374151] -translate-x-1/2"></div>
          
          {/* Whiskers */}
          <div className="absolute left-1/4 right-1/4 h-0.5 bg-slate-400" style={{ bottom: `calc(2rem + ${getPercent(min)}% * calc(100% - 4rem) / 100)` }}></div>
          <div className="absolute left-1/4 right-1/4 h-0.5 bg-slate-400" style={{ bottom: `calc(2rem + ${getPercent(max)}% * calc(100% - 4rem) / 100)` }}></div>
          
          {/* Box */}
          <div className="absolute left-1/4 right-1/4 bg-red-900/30 border-2 border-red-500 rounded-sm" 
               style={{ 
                 bottom: `calc(2rem + ${getPercent(p25)}% * calc(100% - 4rem) / 100)`, 
                 height: `calc(${getPercent(p75) - getPercent(p25)}% * calc(100% - 4rem) / 100)` 
               }}></div>
               
          {/* Median */}
          <div className="absolute left-1/4 right-1/4 h-1 bg-red-500 -translate-y-1/2" style={{ bottom: `calc(2rem + ${getPercent(p50)}% * calc(100% - 4rem) / 100)` }}></div>
          
          {/* Labels */}
          <div className="absolute left-3/4 ml-4 text-xs text-slate-400 -translate-y-1/2 whitespace-nowrap" style={{ bottom: `calc(2rem + ${getPercent(min)}% * calc(100% - 4rem) / 100)` }}>Min: {min.toFixed(1)}</div>
          <div className="absolute left-3/4 ml-4 text-xs text-slate-400 -translate-y-1/2 whitespace-nowrap" style={{ bottom: `calc(2rem + ${getPercent(p25)}% * calc(100% - 4rem) / 100)` }}>Q1: {p25.toFixed(1)}</div>
          <div className="absolute left-3/4 ml-4 text-xs font-bold text-red-400 -translate-y-1/2 whitespace-nowrap" style={{ bottom: `calc(2rem + ${getPercent(p50)}% * calc(100% - 4rem) / 100)` }}>Median: {p50.toFixed(1)}</div>
          <div className="absolute left-3/4 ml-4 text-xs text-slate-400 -translate-y-1/2 whitespace-nowrap" style={{ bottom: `calc(2rem + ${getPercent(p75)}% * calc(100% - 4rem) / 100)` }}>Q3: {p75.toFixed(1)}</div>
          <div className="absolute left-3/4 ml-4 text-xs text-slate-400 -translate-y-1/2 whitespace-nowrap" style={{ bottom: `calc(2rem + ${getPercent(max)}% * calc(100% - 4rem) / 100)` }}>Max: {max.toFixed(1)}</div>
        </div>
      </div>
    );
  };

  const renderLineChart = (colStats: any) => {
    return (
      <div className="h-64 w-full mt-6">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={colStats.sample} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" />
            <XAxis dataKey="index" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={{ stroke: '#4b5563' }} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#1f2937', borderRadius: '8px', border: '1px solid #374151', color: '#f3f4f6', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }} />
            <Line type="monotone" dataKey="value" stroke="#dc2626" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderScatterPlot = (colStats: any) => {
    return (
      <div className="h-64 w-full mt-6">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" />
            <XAxis type="number" dataKey="index" name="Index" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={{ stroke: '#4b5563' }} tickLine={false} />
            <YAxis type="number" dataKey="value" name="Value" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#1f2937', borderRadius: '8px', border: '1px solid #374151', color: '#f3f4f6', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }} />
            <Scatter name="Values" data={colStats.sample} fill="#dc2626" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderChart = () => {
    if (!data || !selectedColumn || selectedColumn === "overview" || !data.stats[selectedColumn]) return null;

    const colStats = data.stats[selectedColumn];
    const chartData = colStats.distribution;

    if (colStats.type === "numeric") {
      return (
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-2">Histogram (Distribution)</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" />
                  <XAxis dataKey="range" angle={-45} textAnchor="end" height={60} tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={{ stroke: '#4b5563' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#374151' }} contentStyle={{ backgroundColor: '#1f2937', borderRadius: '8px', border: '1px solid #374151', color: '#f3f4f6', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }} />
                  <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill="#dc2626" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="border-t border-[#374151] pt-6">
            <h3 className="text-sm font-medium text-slate-300 mb-2">Box Plot</h3>
            {renderBoxPlot(colStats)}
          </div>

          <div className="border-t border-[#374151] pt-6">
            <h3 className="text-sm font-medium text-slate-300 mb-2">Scatter Plot (Outliers)</h3>
            {renderScatterPlot(colStats)}
          </div>

          <div className="border-t border-[#374151] pt-6">
            <h3 className="text-sm font-medium text-slate-300 mb-2">Line Graph (Sampled Data)</h3>
            {renderLineChart(colStats)}
          </div>
        </div>
      );
    } else {
      return (
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Frequency Distribution</h3>
          <div className="h-80 w-full mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 20, right: 30, left: 100, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#374151" />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="value" type="category" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={{ stroke: '#4b5563' }} tickLine={false} />
                <Tooltip cursor={{ fill: '#374151' }} contentStyle={{ backgroundColor: '#1f2937', borderRadius: '8px', border: '1px solid #374151', color: '#f3f4f6', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }} />
                <Bar dataKey="count" fill="#dc2626" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill="#dc2626" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }
  };

  const renderStatsTable = () => {
    if (!data || !selectedColumn || selectedColumn === "overview" || !data.stats[selectedColumn]) return null;
    const colStats = data.stats[selectedColumn];

    if (colStats.type === "numeric") {
      return (
        <div className="bg-[#111827] border border-[#1f2937] rounded-2xl overflow-hidden mt-6 shadow-sm">
          <div className="bg-[#1f2937]/50 px-5 py-4 border-b border-[#1f2937] flex items-center gap-2">
            <TableIcon size={18} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-white tracking-tight">Descriptive Statistics</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#1f2937]">
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Count</p>
              <p className="text-xl font-light text-white">{colStats.count}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Missing</p>
              <p className="text-xl font-light text-white">{colStats.missing}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Mean</p>
              <p className="text-xl font-light text-white">{colStats.mean.toFixed(4)}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Std Dev</p>
              <p className="text-xl font-light text-white">{colStats.std.toFixed(4)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 border-t border-[#1f2937] divide-y sm:divide-y-0 sm:divide-x divide-[#1f2937] bg-[#1f2937]/20">
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Min</p>
              <p className="text-lg font-medium text-slate-300">{colStats.min.toFixed(4)}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">25%</p>
              <p className="text-lg font-medium text-slate-300">{colStats.p25.toFixed(4)}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">50% (Median)</p>
              <p className="text-lg font-bold text-red-400">{colStats.p50.toFixed(4)}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">75%</p>
              <p className="text-lg font-medium text-slate-300">{colStats.p75.toFixed(4)}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Max</p>
              <p className="text-lg font-medium text-slate-300">{colStats.max.toFixed(4)}</p>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="bg-[#111827] border border-[#1f2937] rounded-2xl overflow-hidden mt-6 shadow-sm">
          <div className="bg-[#1f2937]/50 px-5 py-4 border-b border-[#1f2937] flex items-center gap-2">
            <TableIcon size={18} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-white tracking-tight">Categorical Statistics</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#1f2937]">
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Count</p>
              <p className="text-xl font-light text-white">{colStats.count}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Missing</p>
              <p className="text-xl font-light text-white">{colStats.missing}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Unique</p>
              <p className="text-xl font-light text-white">{colStats.unique}</p>
            </div>
            <div className="p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Top Value</p>
              <p className="text-lg font-medium text-white truncate" title={colStats.top}>{colStats.top || "N/A"}</p>
              <p className="text-xs text-slate-400 mt-1">Freq: {colStats.freq}</p>
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1121] text-slate-200 font-sans">
      <header className="bg-[#111827] border-b border-[#1f2937] px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="bg-red-600 p-2 rounded-xl text-white shadow-md shadow-red-900/20">
            <BarChart3 size={22} />
          </div>
          <h1 className="text-xl font-semibold text-white tracking-tight">AI Data Explorer</h1>
        </div>
      </header>

      <main className="w-full">
        <AnimatePresence mode="wait">
          {!data ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              {/* Hero Section */}
              <div className="relative w-full overflow-hidden min-h-[600px] flex items-center justify-center border-b border-[#1f2937]">
                <div className="absolute inset-0">
                  <img 
                    src="https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=2000&auto=format&fit=crop" 
                    alt="AI Data Background" 
                    className="w-full h-full object-cover opacity-20"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-[#0b1121]/40 via-[#0b1121]/80 to-[#0b1121]"></div>
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0b1121] via-transparent to-[#0b1121]"></div>
                </div>
                
                <div className="relative z-10 px-6 py-20 flex flex-col items-center text-center max-w-5xl mx-auto w-full">
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-900/30 border border-red-500/30 text-red-400 text-sm font-medium mb-8 shadow-lg backdrop-blur-sm">
                    <Sparkles size={16} />
                    <span>Powered by Gemini AI</span>
                  </div>
                  <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight leading-tight">
                    Uncover the <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-rose-400">hidden stories</span> in your data.
                  </h1>
                  <p className="text-xl text-slate-400 mb-12 max-w-2xl mx-auto leading-relaxed">
                    Transform raw CSV and JSON files into beautiful visualizations, comprehensive statistics, and intelligent AI-driven insights in seconds.
                  </p>

                  <div className="w-full max-w-2xl mx-auto bg-[#111827]/80 backdrop-blur-xl rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.5)] border border-[#1f2937] p-8 text-center">
                    <div
                      className={`border-2 border-dashed rounded-[20px] p-10 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-4 ${
                        file ? "border-red-500 bg-red-900/10" : "border-[#374151] hover:border-red-500 hover:bg-[#1f2937]/50"
                      }`}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        type="file"
                        accept=".csv,.json"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                      />
                      
                      {file ? (
                        <>
                          <div className="bg-red-900/30 p-4 rounded-full text-red-500 shadow-sm">
                            <FileType size={36} />
                          </div>
                          <div>
                            <p className="font-semibold text-white text-lg">{file.name}</p>
                            <p className="text-sm text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="bg-[#1f2937] p-5 rounded-full text-slate-400 mb-2">
                            <Upload size={40} strokeWidth={1.5} />
                          </div>
                          <div>
                            <p className="font-medium text-slate-300 text-lg">Click to upload or drag and drop</p>
                            <p className="text-sm text-slate-500 mt-1">Supports CSV and JSON files</p>
                          </div>
                        </>
                      )}
                    </div>

                    {error && (
                      <div className="mt-6 p-4 bg-red-900/20 text-red-400 rounded-xl flex items-center gap-3 text-sm text-left border border-red-900/50">
                        <AlertCircle size={18} className="shrink-0" />
                        {error}
                      </div>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUpload();
                      }}
                      disabled={!file || loading}
                      className="mt-6 w-full bg-red-600 hover:bg-red-700 text-white font-medium py-4 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 text-lg shadow-md"
                    >
                      {loading ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Processing...
                        </>
                      ) : (
                        "Generate Dashboard"
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Features Section */}
              <div className="max-w-7xl mx-auto px-6 py-20">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="bg-[#111827] border border-[#1f2937] p-8 rounded-3xl hover:border-red-500/50 transition-colors duration-300 shadow-lg">
                    <div className="w-14 h-14 bg-blue-900/30 text-blue-500 rounded-2xl flex items-center justify-center mb-6 border border-blue-500/20">
                      <Database size={28} />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-3">Instant Processing</h3>
                    <p className="text-slate-400 leading-relaxed">Upload your raw data and instantly receive comprehensive descriptive statistics, missing value analysis, and data type detection.</p>
                  </div>
                  <div className="bg-[#111827] border border-[#1f2937] p-8 rounded-3xl hover:border-red-500/50 transition-colors duration-300 shadow-lg">
                    <div className="w-14 h-14 bg-emerald-900/30 text-emerald-500 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/20">
                      <BarChart3 size={28} />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-3">Smart Visualizations</h3>
                    <p className="text-slate-400 leading-relaxed">Automatically generated histograms, box plots, and correlation matrices that adapt to your specific data types and distributions.</p>
                  </div>
                  <div className="bg-[#111827] border border-[#1f2937] p-8 rounded-3xl hover:border-red-500/50 transition-colors duration-300 shadow-lg">
                    <div className="w-14 h-14 bg-purple-900/30 text-purple-500 rounded-2xl flex items-center justify-center mb-6 border border-purple-500/20">
                      <Sparkles size={28} />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-3">AI-Powered Insights</h3>
                    <p className="text-slate-400 leading-relaxed">Leverage advanced AI to interpret complex correlations, identify outliers, and summarize key trends in plain English.</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
              className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-4 gap-8"
            >
              {/* Sidebar */}
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-[#111827] rounded-[24px] shadow-[0_2px_10px_rgb(0,0,0,0.2)] border border-[#1f2937] p-6">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">Dataset Info</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#1f2937]/50 p-4 rounded-2xl border border-[#1f2937]">
                      <p className="text-2xl font-light text-white tracking-tight">{data.rowCount.toLocaleString()}</p>
                      <p className="text-[10px] font-semibold text-slate-400 mt-1 uppercase tracking-widest">Rows</p>
                    </div>
                    <div className="bg-[#1f2937]/50 p-4 rounded-2xl border border-[#1f2937]">
                      <p className="text-2xl font-light text-white tracking-tight">{data.columnCount}</p>
                      <p className="text-[10px] font-semibold text-slate-400 mt-1 uppercase tracking-widest">Columns</p>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => {
                      setData(null);
                      setFile(null);
                    }}
                    className="mt-6 w-full py-2.5 px-4 border border-[#374151] hover:bg-[#1f2937] hover:border-[#4b5563] rounded-xl text-sm font-medium text-slate-300 transition-all duration-200"
                  >
                    Upload New File
                  </button>
                </div>

                <div className="bg-[#111827] rounded-[24px] shadow-[0_2px_10px_rgb(0,0,0,0.2)] border border-[#1f2937] p-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 px-2 pt-2">Navigation</h3>
                  <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                    <button
                      onClick={() => setSelectedColumn("overview")}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm flex items-center gap-3 transition-all duration-200 mb-3 ${
                        selectedColumn === "overview" 
                          ? "bg-red-600 text-white font-medium shadow-md" 
                          : "text-slate-400 hover:bg-[#1f2937] hover:text-slate-200"
                      }`}
                    >
                      <LayoutDashboard size={18} className={selectedColumn === "overview" ? "text-white" : "text-slate-500"} />
                      Global Overview
                    </button>
                    
                    <div className="pt-3 border-t border-[#1f2937]">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-3">Variables</p>
                      {data.columns.map((col) => {
                        const isSelected = selectedColumn === col;
                        const type = data.stats[col]?.type;
                        return (
                          <button
                            key={col}
                            onClick={() => setSelectedColumn(col)}
                            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm flex items-center justify-between transition-all duration-200 ${
                              isSelected 
                                ? "bg-red-900/20 text-red-400 font-medium border border-red-900/50" 
                                : "text-slate-400 hover:bg-[#1f2937] hover:text-slate-200 border border-transparent"
                            }`}
                          >
                            <span className="truncate pr-2">{col}</span>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              type === 'numeric' ? 'bg-blue-500' : 'bg-emerald-500'
                            }`} title={type === 'numeric' ? 'Numeric' : 'Categorical'} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Content */}
              <div className="lg:col-span-3 space-y-6">
                {selectedColumn === "overview" && (
                  <div className="bg-[#111827] rounded-[24px] shadow-[0_2px_10px_rgb(0,0,0,0.2)] border border-[#1f2937] p-8">
                    <div className="flex items-center justify-between mb-8">
                      <h2 className="text-2xl font-semibold text-white tracking-tight">Global Overview</h2>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
                      <div className="border border-[#1f2937] p-6 rounded-[20px] bg-[#1f2937]/30 shadow-sm flex flex-col justify-between">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-2 bg-amber-900/30 rounded-lg text-amber-500">
                            <AlertTriangle size={20} />
                          </div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Missing Data</p>
                        </div>
                        <p className="text-4xl font-light text-white tracking-tight">
                          {data.totalMissing.toLocaleString()}
                        </p>
                      </div>
                      
                      <div className="border border-[#1f2937] p-6 rounded-[20px] bg-[#1f2937]/30 shadow-sm flex flex-col justify-between">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-2 bg-red-900/30 rounded-lg text-red-500">
                            <Info size={20} />
                          </div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Missing %</p>
                        </div>
                        <p className="text-4xl font-light text-white tracking-tight">
                          {data.missingPercentage.toFixed(1)}<span className="text-2xl text-slate-500 ml-1">%</span>
                        </p>
                      </div>
                      
                      <div className="border border-[#1f2937] p-6 rounded-[20px] bg-[#1f2937]/30 shadow-sm flex flex-col justify-between">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="p-2 bg-blue-900/30 rounded-lg text-blue-500">
                            <Columns size={20} />
                          </div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Numeric Cols</p>
                        </div>
                        <p className="text-4xl font-light text-white tracking-tight">
                          {data.numericColumns.length} <span className="text-xl text-slate-500 font-normal">/ {data.columnCount}</span>
                        </p>
                      </div>
                    </div>

                    {/* AI Insights Section */}
                    <div className="mb-10 bg-gradient-to-br from-[#1e1b4b] to-[#312e81] rounded-[20px] p-6 border border-[#4338ca] shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-[#4f46e5] rounded-lg text-white shadow-sm">
                            <Sparkles size={20} />
                          </div>
                          <h3 className="text-lg font-semibold text-white tracking-tight">AI Data Insights</h3>
                        </div>
                        {!aiInsights["overview"] && (
                          <button 
                            onClick={() => generateInsight("overview", "Global Dataset Overview", data)}
                            disabled={generatingInsight}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                          >
                            {generatingInsight ? <><Loader2 size={16} className="animate-spin" /> Analyzing...</> : "Generate Insights"}
                          </button>
                        )}
                      </div>
                      
                      {aiInsights["overview"] ? (
                        <div className="bg-[#0f172a]/60 rounded-xl p-5 border border-[#1e293b] backdrop-blur-sm">
                          <div className="markdown-body text-slate-300 text-sm leading-relaxed">
                            <Markdown>{aiInsights["overview"]}</Markdown>
                          </div>
                        </div>
                      ) : (
                        <p className="text-slate-400 text-sm">Click the button to generate an AI-powered summary of your dataset's structure, missing values, and key correlations.</p>
                      )}
                    </div>

                    {data.numericColumns.length > 1 && (
                      <div className="border-t border-[#1f2937] pt-8 mt-4">
                        <h3 className="text-lg font-medium text-white mb-6 tracking-tight">Pearson Correlation Matrix</h3>
                        <div className="bg-[#1f2937]/30 rounded-2xl p-4 border border-[#1f2937]">
                          {renderCorrelationMatrix()}
                        </div>
                      </div>
                    )}

                    <div className="border-t border-[#1f2937] pt-8 mt-10">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-emerald-900/30 text-emerald-500 rounded-lg">
                          <Database size={20} />
                        </div>
                        <h3 className="text-xl font-semibold text-white tracking-tight">Variables</h3>
                      </div>
                      <p className="text-slate-400 mb-8 text-sm">
                        Select a variable to view detailed descriptive statistics, histograms, box plots, and frequency distributions.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data.columns.map(col => (
                          <button
                            key={col}
                            onClick={() => setSelectedColumn(col)}
                            className="p-5 border border-[#374151] rounded-[16px] hover:border-red-500 hover:shadow-md bg-[#1f2937]/50 transition-all duration-200 text-left flex flex-col gap-3 group"
                          >
                            <div className="flex justify-between items-start w-full">
                              <span className="font-semibold text-white truncate pr-2 group-hover:text-red-400 transition-colors">{col}</span>
                              <ChevronRight size={16} className="text-slate-500 group-hover:text-red-400 transition-colors shrink-0" />
                            </div>
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md w-fit uppercase tracking-wider ${
                              data.stats[col]?.type === 'numeric' ? 'bg-blue-900/30 text-blue-400' : 'bg-emerald-900/30 text-emerald-400'
                            }`}>
                              {data.stats[col]?.type === 'numeric' ? 'Numeric' : 'Categorical'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {selectedColumn && selectedColumn !== "overview" && data.stats[selectedColumn] && (
                  <div className="bg-[#111827] rounded-[24px] shadow-[0_2px_10px_rgb(0,0,0,0.2)] border border-[#1f2937] p-8">
                    <div className="flex items-center justify-between mb-8">
                      <h2 className="text-2xl font-semibold text-white tracking-tight">{selectedColumn}</h2>
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 bg-[#1f2937]/50 px-4 py-2 rounded-xl border border-[#374151]">
                        <span className={`w-2 h-2 rounded-full ${data.stats[selectedColumn].type === 'numeric' ? 'bg-blue-500' : 'bg-emerald-500'}`}></span>
                        {data.stats[selectedColumn].type === 'numeric' ? 'Numeric' : 'Categorical'}
                      </div>
                    </div>

                    {/* AI Insights Section for Column */}
                    <div className="mb-8 bg-gradient-to-br from-[#1e1b4b] to-[#312e81] rounded-[20px] p-6 border border-[#4338ca] shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-[#4f46e5] rounded-lg text-white shadow-sm">
                            <Sparkles size={20} />
                          </div>
                          <h3 className="text-lg font-semibold text-white tracking-tight">AI Column Analysis</h3>
                        </div>
                        {!aiInsights[selectedColumn] && (
                          <button 
                            onClick={() => generateInsight(selectedColumn, `Column: ${selectedColumn}`, data.stats[selectedColumn])}
                            disabled={generatingInsight}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                          >
                            {generatingInsight ? <><Loader2 size={16} className="animate-spin" /> Analyzing...</> : "Generate Insights"}
                          </button>
                        )}
                      </div>
                      
                      {aiInsights[selectedColumn] ? (
                        <div className="bg-[#0f172a]/60 rounded-xl p-5 border border-[#1e293b] backdrop-blur-sm">
                          <div className="markdown-body text-slate-300 text-sm leading-relaxed">
                            <Markdown>{aiInsights[selectedColumn]}</Markdown>
                          </div>
                        </div>
                      ) : (
                        <p className="text-slate-400 text-sm">Click the button to generate an AI-powered analysis of this variable's distribution, outliers, and key characteristics.</p>
                      )}
                    </div>

                    {renderStatsTable()}

                    <div className="mt-10">
                      {renderChart()}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #374151;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #4b5563;
        }
        .markdown-body p { margin-bottom: 0.75em; }
        .markdown-body p:last-child { margin-bottom: 0; }
        .markdown-body strong { font-weight: 600; color: #f8fafc; }
        .markdown-body ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 0.75em; }
        .markdown-body li { margin-bottom: 0.25em; }
        .markdown-body h1, .markdown-body h2, .markdown-body h3 { font-weight: 600; color: #f8fafc; margin-bottom: 0.5em; margin-top: 1em; }
        .markdown-body h1:first-child, .markdown-body h2:first-child, .markdown-body h3:first-child { margin-top: 0; }
      `}} />
    </div>
  );
}
