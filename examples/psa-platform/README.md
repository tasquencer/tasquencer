# Psa Platform

A Tasquencer workflow application with Convex, Better Auth, and React.

## Tech Stack

- **Backend**: Convex (serverless database & functions)
- **Workflow Engine**: Tasquencer
- **Authentication**: Better Auth with Convex integration
- **Frontend**: React + TanStack Router + TanStack Query
- **UI**: Radix UI + Tailwind CSS

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Convex Development Server

```bash
npx convex dev
```

This will:
- Create a new Convex project (if first time)
- Generate `.env.local` with your deployment URLs
- Start the Convex dev server

### 3. Configure Better Auth

Set up the required environment variables. See the [Better Auth + TanStack Start guide](https://labs.convex.dev/better-auth/framework-guides/tanstack-start#set-environment-variables) for details.

Your `.env.local` should contain:

```bash
CONVEX_DEPLOYMENT=dev:your-project-name
VITE_CONVEX_URL=https://your-project-name.convex.cloud
VITE_CONVEX_SITE_URL=https://your-project-name.convex.site
SITE_URL=http://localhost:3000
```

### 4. Start the App & Register a User

```bash
pnpm dev
```

Open `http://localhost:3000` and register a new user account.

### 5. Run Setup Mutations

After registering your first user, run this Convex mutation from the CLI:

```bash
# Create superadmin role and assign to your user
npx convex run scaffold:scaffoldSuperadmin
```

## Adding Workflows

Use the Tasquencer scaffolder to add new workflows:

```bash
# Generate workflow files from designer output
pnpm scaffolder generate -i workflow.json -o ./convex
```

After scaffolding, you'll need to:
1. Update `convex/schema.ts` to import your workflow tables
2. Update `convex/authorization.ts` to register your scope module
3. Update `convex/workflows/metadata.ts` to register your version manager
4. Implement your work item handlers

## Admin Features

- `/admin/users` - User management
- `/admin/groups` - Group management and membership
- `/admin/roles` - Role definitions and scope assignments
- `/audit` - Workflow execution traces
