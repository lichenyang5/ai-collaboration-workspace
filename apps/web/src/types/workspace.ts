export interface TeamSummary {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
}