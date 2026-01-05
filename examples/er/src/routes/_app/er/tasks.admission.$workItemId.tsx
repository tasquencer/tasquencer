import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@repo/ui/components/label";
import { Input } from "@repo/ui/components/input";
import { DoorOpen } from "lucide-react";
import { SpinningLoader } from "@/components/spinning-loader";
import { createErTaskComponent } from "@/features/er/task/createErTaskComponent";

const schema = z.object({
  roomNumber: z.string().min(1, "Room number is required"),
  ward: z.string().min(1, "Ward is required"),
});

const AdmissionTaskComponent = createErTaskComponent({
  workflowTaskName: "admitToHospital",
  schema,
  getDefaultValues: () => ({
    roomNumber: "",
    ward: "",
  }),
  mapSubmit: ({ values, patient }) => ({
    payload: {
      patientId: patient._id,
      roomNumber: values.roomNumber,
      ward: values.ward,
    },
  }),
  renderForm: ({ form, isStarted }) => (
    <>
      <div className="grid gap-2">
        <Label htmlFor="roomNumber">Room Number</Label>
        <Input
          id="roomNumber"
          placeholder="e.g., 302"
          {...form.register("roomNumber")}
          disabled={!isStarted}
        />
        {form.formState.errors.roomNumber && (
          <p className="text-sm text-destructive">
            {form.formState.errors.roomNumber.message}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ward">Ward</Label>
        <Input
          id="ward"
          placeholder="e.g., Post-Surgery Recovery"
          {...form.register("ward")}
          disabled={!isStarted}
        />
        {form.formState.errors.ward && (
          <p className="text-sm text-destructive">
            {form.formState.errors.ward.message}
          </p>
        )}
      </div>
    </>
  ),
  icon: <DoorOpen className="h-8 w-8 text-blue-500" />,
  title: "Hospital Admission",
  description: "Admit patient to hospital ward",
  formTitle: "Hospital Admission Form",
  formDescription: "Assign patient to room and ward",
  submitButtonText: "Complete Admission",
});

export const Route = createFileRoute("/_app/er/tasks/admission/$workItemId")({
  component: AdmissionTask,
  params: {
    parse: ({ workItemId }) => ({
      workItemId: workItemId as Id<"tasquencerWorkItems">,
    }),
  },
});

function AdmissionTask() {
  const { workItemId } = Route.useParams();
  return (
    <Suspense fallback={<SpinningLoader />}>
      <AdmissionTaskComponent workItemId={workItemId} />
    </Suspense>
  );
}
