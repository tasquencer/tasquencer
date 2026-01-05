import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@repo/ui/components/card";
import { UserPlus, AlertCircle, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";

const schema = z.object({
  name: z.string().min(1, "Patient name is required"),
  complaint: z.string().min(1, "Chief complaint is required"),
});

type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/_app/er/new")({
  component: NewPatient,
});

function NewPatient() {
  const navigate = useNavigate();
  const initializePatient = useMutation(
    api.workflows.er.api.patients.initializePatientJourney
  );
  const canAdmit = useQuery(api.workflows.er.api.permissions.canAdmitPatient);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      complaint: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    const patientId = await initializePatient(values);
    navigate({ to: "/er/$patientId", params: { patientId } });
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
      <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-primary/20">
            <UserPlus className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Admit New Patient
            </h1>
            <p className="text-base md:text-lg text-muted-foreground">
              Capture the basics so the team can begin triage immediately.
            </p>
          </div>
        </div>

        {canAdmit === false && (
          <Alert variant="destructive" className="border-red-500/30">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Access Denied</AlertTitle>
            <AlertDescription>
              You do not have permission to admit patients. Please contact your
              administrator to be added to the appropriate ER staff group.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-semibold">
                Patient Information
              </CardTitle>
              <CardDescription>
                Enter patient details to begin triage and diagnostics.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pb-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Patient Name
                </Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  {...form.register("name")}
                  disabled={canAdmit === false}
                  className="h-11"
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="complaint" className="text-sm font-medium">
                  Chief Complaint
                </Label>
                <Textarea
                  id="complaint"
                  placeholder="Describe the patient's primary symptoms or reason for visit..."
                  rows={4}
                  {...form.register("complaint")}
                  disabled={canAdmit === false}
                  className="resize-none"
                />
                {form.formState.errors.complaint && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.complaint.message}
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col-reverse gap-3 px-6 py-4 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate({ to: "/er" })}
                disabled={form.formState.isSubmitting || canAdmit === false}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Patient List
              </Button>
              <Button
                type="submit"
                disabled={canAdmit === false}
                size="lg"
                className="gap-2"
              >
                <UserPlus className="h-4 w-4" />
                {form.formState.isSubmitting ? "Admitting..." : "Admit Patient"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>
    </div>
  );
}
