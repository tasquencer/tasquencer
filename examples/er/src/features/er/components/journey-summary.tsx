import type { CareTimelineEventType, PatientTimelineEvent } from "@/types/er";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Badge } from "@repo/ui/components/badge";
import { cn } from "@/lib/utils";
import {
  ClipboardCheck,
  UserPlus,
  Building2,
  Stethoscope,
  Scan,
  TestTube,
  FileSearch,
  MessageSquare,
  CheckCircle,
  CalendarCheck,
  Pill,
  Syringe,
  Heart,
  FileCheck,
} from "lucide-react";

const EVENT_CONFIG: Record<
  CareTimelineEventType,
  {
    label: string;
    icon: React.ElementType;
    badgeClass: string;
  }
> = {
  triage: {
    label: "Triage",
    icon: ClipboardCheck,
    badgeClass: "bg-amber-500 text-white border-transparent",
  },
  admission: {
    label: "Admitted",
    icon: UserPlus,
    badgeClass: "bg-emerald-600 text-white border-transparent",
  },
  hospital_admission: {
    label: "Hospital Stay",
    icon: Building2,
    badgeClass: "bg-cyan-600 text-white border-transparent",
  },
  diagnostics_started: {
    label: "Diagnostics",
    icon: Stethoscope,
    badgeClass: "bg-blue-600 text-white border-transparent",
  },
  xray_completed: {
    label: "X-Ray",
    icon: Scan,
    badgeClass: "bg-purple-600 text-white border-transparent",
  },
  blood_results: {
    label: "Blood Work",
    icon: TestTube,
    badgeClass: "bg-teal-600 text-white border-transparent",
  },
  diagnostic_review: {
    label: "Diagnostic Review",
    icon: FileSearch,
    badgeClass: "bg-indigo-600 text-white border-transparent",
  },
  consult_requested: {
    label: "Consult Requested",
    icon: MessageSquare,
    badgeClass: "bg-violet-600 text-white border-transparent",
  },
  consult_completed: {
    label: "Consult Completed",
    icon: CheckCircle,
    badgeClass: "bg-violet-600 text-white border-transparent",
  },
  daily_check: {
    label: "Daily Check",
    icon: CalendarCheck,
    badgeClass: "bg-blue-500 text-white border-transparent",
  },
  medication: {
    label: "Medication",
    icon: Pill,
    badgeClass: "bg-green-600 text-white border-transparent",
  },
  daily_medication: {
    label: "Daily Medication",
    icon: Pill,
    badgeClass: "bg-green-600 text-white border-transparent",
  },
  discharge_medication: {
    label: "Discharge Medication",
    icon: Syringe,
    badgeClass: "bg-green-600 text-white border-transparent",
  },
  surgery: {
    label: "Surgery",
    icon: Heart,
    badgeClass: "bg-red-600 text-white border-transparent",
  },
  discharge_follow_up: {
    label: "Follow-up",
    icon: FileCheck,
    badgeClass: "bg-gray-500 text-white border-transparent",
  },
};

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const renderMetadata = (event: PatientTimelineEvent) => {
  if (!event.metadata) return null;

  const details: string[] = [];
  const description = event.description ?? "";

  // Combine severity and vitals into single line if both present
  // Skip if already shown in description
  const severityVitals: string[] = [];
  if (
    typeof event.metadata.severity === "string" &&
    !description.includes("Severity:")
  ) {
    severityVitals.push(
      `Severity: ${event.metadata.severity.charAt(0).toUpperCase() + event.metadata.severity.slice(1)}`
    );
  }
  if (
    typeof event.metadata.vitalSigns === "string" &&
    !description.includes("Vitals:")
  ) {
    severityVitals.push(`Vitals: ${event.metadata.vitalSigns}`);
  }
  if (severityVitals.length > 0) {
    details.push(severityVitals.join(" · "));
  }

  if (
    typeof event.metadata.prescribeMedication === "boolean" &&
    !description.includes("Medication")
  ) {
    details.push(
      `Medication recommended: ${event.metadata.prescribeMedication ? "Yes" : "No"}`
    );
  }

  if (
    typeof event.metadata.source === "string" &&
    !description.includes("Source:")
  ) {
    const formattedSource = event.metadata.source
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    details.push(`Source: ${formattedSource}`);
  }

  if (
    typeof event.metadata.critical === "boolean" &&
    event.metadata.critical &&
    !description.includes("critical")
  ) {
    details.push("Marked critical");
  }

  if (
    typeof event.metadata.followUpRequired === "boolean" &&
    !description.includes("Follow-up")
  ) {
    details.push(
      `Follow-up required: ${event.metadata.followUpRequired ? "Yes" : "No"}`
    );
  }

  if (
    typeof event.metadata.dischargeInstructions === "string" &&
    !description.includes("Instructions:")
  ) {
    details.push(`Instructions: ${event.metadata.dischargeInstructions}`);
  }

  if (!details.length) return null;

  return (
    <div className="text-sm text-muted-foreground space-y-0.5 mt-1">
      {details.map((detail, idx) => (
        <div key={idx}>{detail}</div>
      ))}
    </div>
  );
};

export function JourneySummary({
  timeline,
  className,
}: {
  timeline: PatientTimelineEvent[];
  className?: string;
}) {
  if (!timeline || timeline.length === 0) {
    return null;
  }

  const sortedTimeline = [...timeline].sort(
    (a, b) => a.timestamp - b.timestamp
  );

  return (
    <Card className={cn("shadow-sm border-border/50", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold">Care Timeline</CardTitle>
      </CardHeader>
      <CardContent className="relative">
        {/* Vertical line */}
        <div className="absolute left-[19px] top-0 bottom-4 w-0.5 bg-border" />

        <div className="space-y-6">
          {sortedTimeline.map((event, index) => {
            const config = EVENT_CONFIG[event.type] ?? {
              label: "Event",
              icon: CheckCircle,
              badgeClass: "bg-gray-500 text-white border-transparent",
            };

            // Override badge class for critical x-ray
            const badgeClass =
              event.type === "xray_completed" && event.metadata?.critical
                ? "bg-red-600 text-white border-transparent"
                : config.badgeClass;

            return (
              <div key={event.id} className="relative pl-10">
                {/* Timeline dot */}
                <div className="absolute left-0 top-0.5 flex h-10 w-10 items-center justify-center">
                  <div
                    className={cn(
                      "h-3 w-3 rounded-full ring-4 ring-background",
                      event.type === "xray_completed" &&
                        event.metadata?.critical
                        ? "bg-red-500"
                        : index === sortedTimeline.length - 1
                          ? "bg-primary"
                          : "bg-muted-foreground/40"
                    )}
                  />
                </div>

                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between pb-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={cn(
                          "text-xs font-semibold tracking-wide shadow-sm shrink-0",
                          badgeClass
                        )}
                      >
                        {config.label}
                      </Badge>
                      <span className="font-medium text-sm">{event.title}</span>
                    </div>
                    {event.description && (
                      <p className="text-sm text-muted-foreground">
                        {event.description}
                      </p>
                    )}
                    {renderMetadata(event)}
                  </div>
                  <div className="text-xs text-muted-foreground sm:text-right shrink-0 sm:ml-4">
                    {formatTimestamp(event.timestamp)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
