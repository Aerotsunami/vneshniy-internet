export type Source = {
  label: string;
  url: string;
  date: string;
};

export type Material = {
  id: string;
  title: string;
  topic: string;
  isAi: boolean;
  body: string[];
  sources: Source[];
  check: string[];
};

export type Issue = {
  date: string;
  label: string;
  summary: string;
  materials: Material[];
};

export type Archive = {
  generatedAt: string;
  issueCount: number;
  topics: string[];
  issues: Issue[];
};
