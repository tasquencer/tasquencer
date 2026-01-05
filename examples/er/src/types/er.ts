import type { Doc, Id } from "@/convex/_generated/dataModel";

export type TaskMetadata = {
  _id: Id<"erWorkItems">;
  _creationTime: number;
  workItemId: Id<"tasquencerWorkItems">;
  patientId: Id<"erPatients">;
  taskName: string;
  taskType?: string;
  status: "pending" | "claimed" | "completed";
  assignedRoleId?: string;
  assignedRoleName?: string;
  assignedGroupId?: string;
  assignedGroupName?: string;
  claimedBy?: string;
  priority?: "routine" | "urgent" | "critical";
  workItemState?: string;
  payload: Doc<"erWorkItems">["payload"];
};

export type CareTimelineEventType =
  | "triage"
  | "admission"
  | "hospital_admission"
  | "diagnostics_started"
  | "xray_completed"
  | "blood_results"
  | "diagnostic_review"
  | "consult_requested"
  | "consult_completed"
  | "daily_check"
  | "medication"
  | "daily_medication"
  | "discharge_medication"
  | "surgery"
  | "discharge_follow_up";

export type PatientTimelineEvent = {
  id: string;
  timestamp: number;
  type: CareTimelineEventType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type PatientJourneyDetails = {
  diagnostics: Doc<"erDiagnostics"> | null;
  latestReview: Doc<"erDiagnosticReviews"> | null;
  consultations: Array<Doc<"erSpecialistConsultations">>;
  medications: Array<Doc<"erMedicationAdministrations">>;
  surgeries: Array<Doc<"erSurgeryEvents">>;
  diagnosticReviews: Array<Doc<"erDiagnosticReviews">>;
  dailyChecks: Array<Doc<"erDailyCheckAssessments">>;
  timeline: PatientTimelineEvent[];
};
