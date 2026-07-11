export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `https://api.github.com${path}`;
    const headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${this.token}`,
      'User-Agent': 'portway-control-plane',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GitHub API Error: [${response.status}] ${response.statusText}. Response: ${body}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  // List all repositories owned or accessible by the authenticated user
  async getUserRepos(): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>('/user/repos?per_page=100&sort=updated');
  }

  // Register a deployment webhook in the repository
  async createWebhook(
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string
  ): Promise<any> {
    const payload = {
      name: 'web',
      active: true,
      events: ['push', 'pull_request'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret: secret,
        insecure_ssl: '0',
      },
    };

    return this.request<any>(`/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Update commit checks status (e.g. success, failure, pending)
  async updateCommitStatus(
    owner: string,
    repo: string,
    sha: string,
    state: 'pending' | 'success' | 'failure' | 'error',
    targetUrl: string,
    description: string,
    context = 'Portway Deployment'
  ): Promise<any> {
    const payload = {
      state,
      target_url: targetUrl,
      description,
      context,
    };

    return this.request<any>(`/repos/${owner}/${repo}/statuses/${sha}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}
