"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { apiFetch } from "@/utils/api";

interface GitHubRepo {
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
}

export default function NewProjectPage() {
  const router = useRouter();
  
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [repoError, setRepoError] = useState("");

  const [selectedRepoUrl, setSelectedRepoUrl] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [installCommand, setInstallCommand] = useState("npm install");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [outputDir, setOutputDir] = useState("dist");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    apiFetch("/projects/github-repos")
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        throw new Error("Failed to load repositories from GitHub.");
      })
      .then((data) => {
        setRepos(data.repos || []);
        setLoadingRepos(false);
      })
      .catch((err) => {
        setRepoError(err.message);
        setLoadingRepos(false);
      });
  }, []);

  const handleRepoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const url = e.target.value;
    setSelectedRepoUrl(url);

    if (url) {
      const selected = repos.find((r) => r.url === url);
      if (selected) {
        setName(selected.name);
        setBranch(selected.defaultBranch || "main");
      }
    } else {
      setName("");
      setBranch("main");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoUrl || !name) {
      setSubmitError("Please select a repository and enter a project name.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const res = await apiFetch("/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          githubRepoUrl: selectedRepoUrl,
          branch,
          installCommand: installCommand || null,
          buildCommand: buildCommand || null,
          outputDir: outputDir || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to create project.");
      }

      router.push(`/projects/${data.project.id}`);
    } catch (err: any) {
      setSubmitError(err.message || "An unexpected error occurred.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 relative">
        <div className="absolute top-10 left-10 h-64 w-64 rounded-full bg-indigo-500/5 blur-[90px]"></div>

        <div className="border-b border-zinc-800/85 pb-6 relative z-10">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Create a New Project</h1>
          <p className="text-zinc-400 mt-1.5 text-sm">
            Import a repository from your GitHub account and configure the build settings.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6 relative z-10">
          {submitError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
              <p className="text-sm font-semibold text-red-400">{submitError}</p>
            </div>
          )}

          {/* GitHub Repo Selection */}
          <div className="space-y-2">
            <label htmlFor="repo" className="block text-sm font-semibold text-zinc-300">
              GitHub Repository
            </label>
            {loadingRepos ? (
              <div className="flex items-center space-x-3 py-2 bg-zinc-900/40 border border-zinc-800/80 rounded-lg px-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></div>
                <span className="text-xs text-zinc-500">Fetching accessible repositories...</span>
              </div>
            ) : repoError ? (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-sm text-yellow-400">
                {repoError} Ensure you have authorized Portway on GitHub.
              </div>
            ) : (
              <select
                id="repo"
                value={selectedRepoUrl}
                onChange={handleRepoChange}
                className="block w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-sm text-zinc-100 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
              >
                <option value="">Select a repository...</option>
                {repos.map((repo) => (
                  <option key={repo.url} value={repo.url}>
                    {repo.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Project configuration parameters (only display if repo is selected) */}
          {selectedRepoUrl && (
            <div className="space-y-6 animate-fadeIn">
              {/* Project Name & Branch */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="name" className="block text-sm font-semibold text-zinc-300">
                    Project Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="block w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-sm text-zinc-100 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="e.g. My Website"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="branch" className="block text-sm font-semibold text-zinc-300">
                    Production Branch
                  </label>
                  <input
                    type="text"
                    id="branch"
                    required
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="block w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-sm text-zinc-100 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono"
                    placeholder="e.g. main"
                  />
                </div>
              </div>

              {/* Build Configuration Box */}
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/20 p-6">
                <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-4">Build Settings</h3>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="installCommand" className="block text-xs font-semibold text-zinc-400">
                      Install Command
                    </label>
                    <input
                      type="text"
                      id="installCommand"
                      value={installCommand}
                      onChange={(e) => setInstallCommand(e.target.value)}
                      className="block w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-xs text-zinc-100 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono"
                      placeholder="e.g. npm install"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="buildCommand" className="block text-xs font-semibold text-zinc-400">
                      Build Command
                    </label>
                    <input
                      type="text"
                      id="buildCommand"
                      value={buildCommand}
                      onChange={(e) => setBuildCommand(e.target.value)}
                      className="block w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-xs text-zinc-100 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono"
                      placeholder="e.g. npm run build"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="outputDir" className="block text-xs font-semibold text-zinc-400">
                      Output Directory
                    </label>
                    <input
                      type="text"
                      id="outputDir"
                      value={outputDir}
                      onChange={(e) => setOutputDir(e.target.value)}
                      className="block w-full rounded-lg border border-zinc-800 bg-zinc-900/50 px-3.5 py-2.5 text-xs text-zinc-100 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono"
                      placeholder="e.g. dist"
                    />
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end space-x-4 border-t border-zinc-800/80 pt-6">
                <button
                  type="button"
                  onClick={() => router.back()}
                  className="rounded-lg border border-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-indigo-500 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                      Connecting Project...
                    </>
                  ) : (
                    "Create Project"
                  )}
                </button>
              </div>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
