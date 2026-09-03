export interface ExpertReview {
  original_status: string | null;
  expert_status: string | null;
  expert_rationale: string | null;
  action: 'approve' | 'override';
  reviewed_at: string;
}

export interface ExpertSummary {
  reviewed_count: number;
  total_reviewable: number;
  unreviewed_items: string[];
  expert_diagnosis: string | null;
  expert_criteria: Record<string, boolean | null> | null;
}

export interface ScorecardItem {
  id: string;
  question: string;
  status: string | null;
  value: string | null;
  rationale: string | null;
  clarification_count: number;
  is_current: boolean;
  is_skipped: boolean;
  expert_review?: ExpertReview | null;
}

export interface ScorecardSection {
  id: string;
  title: string;
  criteria_met: boolean | null;
  items: ScorecardItem[];
}

export interface ScorecardData {
  progress: number;
  answered: number;
  total: number;
  criteria: Record<string, boolean | null>;
  sections: ScorecardSection[];
  early_stop: boolean;
  diagnosis: string | null;
  report: string | null;
  expert_summary?: ExpertSummary | null;
}

export interface InterviewResponse {
  session_id: string;
  response: string;
  conversation: Array<{ role: string; content: string }>;
  scorecard: ScorecardData;
  interview_complete: boolean;
  final_diagnosis: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionSummary {
  session_id: string;
  created_at: string | null;
  updated_at: string | null;
  answered: number;
  total: number;
  progress: number;
  interview_complete: boolean;
  diagnosis: string | null;
  reviewed_count: number;
  reviewable_count: number;
}

export interface SessionDetail {
  session_id: string;
  created_at: string | null;
  updated_at: string | null;
  conversation: Array<{ role: string; content: string }>;
  scorecard: ScorecardData;
  interview_complete: boolean;
  final_diagnosis: string | null;
}
