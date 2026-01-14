import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent } from '@repo/ui/components/card'
import {
  Route as RouteIcon,
  Users,
  CheckCircle2,
  Sparkles,
  Clock,
  Shield,
  Eye,
  Zap,
} from 'lucide-react'

export const Route = createFileRoute('/_app/homepage')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-background to-muted/20">
      <div className="max-w-4xl mx-auto px-6 py-16 space-y-16">
        {/* Hero */}
        <div className="text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            Built with Convex
          </div>
          <h1 className="text-5xl font-bold tracking-tight">
            Meet <span className="text-primary">Tasquencer</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            A headless coordination engine for long-running, human-centric
            processes. Break complex work into clear steps and keep everyone
            moving forward.
          </p>
        </div>

        {/* What it does */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="border-2 hover:border-primary/50 transition-colors">
            <CardContent className="pt-6 text-center space-y-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                <RouteIcon className="h-6 w-6" />
              </div>
              <h3 className="font-semibold">Map Your Process</h3>
              <p className="text-sm text-muted-foreground">
                Turn how your team actually works into clear, repeatable steps
                that anyone can follow.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 hover:border-primary/50 transition-colors">
            <CardContent className="pt-6 text-center space-y-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-green-500/10 text-green-500">
                <Users className="h-6 w-6" />
              </div>
              <h3 className="font-semibold">Involve the Right People</h3>
              <p className="text-sm text-muted-foreground">
                Get tasks to the right person at the right time. No more
                chasing or wondering who's next.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 hover:border-primary/50 transition-colors">
            <CardContent className="pt-6 text-center space-y-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="font-semibold">See Progress Clearly</h3>
              <p className="text-sm text-muted-foreground">
                Know exactly where things stand. Every action is tracked, every
                decision is recorded.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <div className="bg-card rounded-2xl border p-8 space-y-6">
          <h2 className="text-2xl font-semibold text-center">
            Why you'll love it
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Always up to date</p>
                <p className="text-sm text-muted-foreground">
                  Changes appear instantly for everyone. No refreshing, no
                  syncing.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">The right access for everyone</p>
                <p className="text-sm text-muted-foreground">
                  People see only what they need to see and do only what they
                  should do.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Eye className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Full visibility</p>
                <p className="text-sm text-muted-foreground">
                  See who did what and when. Great for audits and understanding
                  bottlenecks.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Handles the long haul</p>
                <p className="text-sm text-muted-foreground">
                  Built for processes that take days, weeks, or months to
                  complete.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Closing */}
        <div className="text-center">
          <p className="text-muted-foreground">
            Explore the sidebar to see Tasquencer in action.
          </p>
        </div>
      </div>
    </div>
  )
}
