import { defineApp } from 'convex/server'
import betterAuth from '@convex-dev/better-auth/convex.config'
import auditComponent from '@repo/tasquencer/components/audit/convex.config'
import authorizationComponent from '@repo/tasquencer/components/authorization/convex.config'

const app = defineApp()

app.use(betterAuth)
app.use(auditComponent)
app.use(authorizationComponent)

export default app
