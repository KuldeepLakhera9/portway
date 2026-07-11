"use client";

import { useEffect, useState, useRef, use } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { apiFetch, getAuthToken, WS_BASE } from "@/utils/api";

interface Deployment {
  id: string;
  project_id: string;
  project_name: string;
  project_slug: string;
  commit_message: string | null;
  commit_author: string | null;
  commit_sha: string | null;
  status: string;
  url: string | null;
  created_at: string;
}

export default function DeploymentLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: deploymentId } = use(params);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Auto-scroll logic
  const scrollToBottom = () => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  useEffect(() => {
    // 1. Fetch deployment info & initial static logs
    Promise.all([
      apiFetch(`/deployments/${deploymentId}`).then((r) => {
        if (r.ok) return r.json();
        throw new Error("Failed to load deployment details.");
      }),
      apiFetch(`/deployments/${deploymentId}/logs`).then((r) => {
        if (r.ok) return r.json();
        throw new Error("Failed to load logs.");
      }),
    ])
      .then(([deployData, logsData]) => {
        setDeployment(deployData);
        if (logsData.logs) {
          setLogs(logsData.logs.split("\n"));
        }
        setLoading(false);

        // 2. Open live WebSocket if build is in progress
        const isLive = deployData.status === "building" || deployData.status === "queued";
        if (isLive) {
          connectWebSocket();
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    return () => {
      // Clean up WebSocket connection on exit
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [deploymentId]);

  const connectWebSocket = () => {
    const token = getAuthToken();
    if (!token) return;

    const wsUrl = `${WS_BASE}/deployments/${deploymentId}/logs/stream?token=${token}`;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "end") {
          // Build completed, set final status to ready
          setDeployment((prev) => prev ? { ...prev, status: data.status || "ready" } : null);
          ws.close();
        } else if (data.line) {
          setLogs((prev) => [...prev, data.line]);
        }
      } catch {
        // Fallback for raw string logs
        if (event.data) {
          setLogs((prev) => [...prev, event.data]);
        }
      }
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed.");
    };

    ws.onerror = (err) => {
      console.error("WebSocket log stream error:", err);
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
        </div>
      </div>
    );
  }

  if (error || !deployment) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-10">
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
            <p className="text-sm font-medium text-red-400">{error || "Deployment not found."}</p>
            <Link href="/projects" className="mt-4 inline-block text-xs font-bold text-indigo-400 hover:underline">
              &larr; Back to projects
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col">
        {/* Navigation Breadcrumb */}
        <div className="text-xs font-semibold text-zinc-500 space-x-2">
          <Link href="/projects" className="hover:text-zinc-300">Projects</Link>
          <span>/</span>
          <Link href={`/projects/${deployment.project_id}`} className="hover:text-zinc-300">
            {deployment.project_name}
          </Link>
          <span>/</span>
          <span className="text-zinc-400">Deployment Logs</span>
        </div>

        {/* Deployment Header */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-zinc-800/80 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100 flex items-center space-x-3">
              <span>Build Output</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  deployment.status === "ready"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : deployment.status === "error"
                    ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    : deployment.status === "building"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                    : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                }`}
              >
                {deployment.status}
              </span>
            </h1>
            
            <p className="mt-2 text-xs text-zinc-400">
              {deployment.commit_message || "Manual Trigger"} &bull;{" "}
              {deployment.commit_sha && (
                <span className="font-mono bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800">
                  {deployment.commit_sha.slice(0, 7)}
                </span>
              )}{" "}
              by {deployment.commit_author || "Unknown"}
            </p>
          </div>

          <div className="flex items-center space-x-3 sm:self-center">
            {deployment.status === "ready" && deployment.url && (
              <a
                href={deployment.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-indigo-650 hover:bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow transition-all cursor-pointer"
              >
                Visit Deployed App &rarr;
              </a>
            )}
          </div>
        </div>

        {/* Terminal logs component */}
        <div className="mt-6 flex-1 flex flex-col">
          <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl overflow-hidden shadow-2xl flex flex-col flex-1">
            {/* Terminal Header */}
            <div className="bg-zinc-900/80 border-b border-zinc-800/80 px-4 py-3 flex items-center justify-between">
              <div className="flex space-x-2">
                <div className="h-3 w-3 rounded-full bg-red-500/30"></div>
                <div className="h-3 w-3 rounded-full bg-yellow-500/30"></div>
                <div className="h-3 w-3 rounded-full bg-green-500/30"></div>
              </div>
              <span className="text-[10px] font-bold font-mono tracking-wide text-zinc-500 uppercase">
                {deployment.status === "building" ? "Live logs streaming" : "Terminal output archive"}
              </span>
            </div>

            {/* Terminal screen text */}
            <div className="flex-1 bg-black p-4 font-mono text-xs text-zinc-300 overflow-y-auto max-h-[550px] h-[550px] selection:bg-indigo-500/30 scrollbar-thin scrollbar-thumb-zinc-800 whitespace-pre-wrap select-text">
              {logs.length === 0 ? (
                <p className="text-zinc-600 italic">Logs buffer is empty. Waiting for execution stdout...</p>
              ) : (
                logs.map((line, idx) => (
                  <div key={idx} className="leading-relaxed hover:bg-zinc-900/20 py-0.5 transition-colors">
                    {line}
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
