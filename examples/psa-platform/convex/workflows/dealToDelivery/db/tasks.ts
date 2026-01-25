/**
 * Database functions for tasks
 */
import type {
  DatabaseReader,
  DatabaseWriter,
} from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import { EntityNotFoundError } from "@repo/tasquencer";

export type TaskStatus = Doc<"tasks">["status"];
export type TaskPriority = Doc<"tasks">["priority"];

export async function insertTask(
  db: DatabaseWriter,
  task: Omit<Doc<"tasks">, "_id" | "_creationTime">
): Promise<Id<"tasks">> {
  return await db.insert("tasks", task);
}

export async function getTask(
  db: DatabaseReader,
  taskId: Id<"tasks">
): Promise<Doc<"tasks"> | null> {
  return await db.get(taskId);
}

export async function updateTaskStatus(
  db: DatabaseWriter,
  taskId: Id<"tasks">,
  status: TaskStatus
): Promise<void> {
  const task = await db.get(taskId);
  if (!task) {
    throw new EntityNotFoundError("Task", { taskId });
  }
  await db.patch(taskId, { status });
}

export async function updateTask(
  db: DatabaseWriter,
  taskId: Id<"tasks">,
  updates: Partial<Omit<Doc<"tasks">, "_id" | "_creationTime" | "projectId" | "organizationId">>
): Promise<void> {
  const task = await db.get(taskId);
  if (!task) {
    throw new EntityNotFoundError("Task", { taskId });
  }
  await db.patch(taskId, updates);
}

export async function listTasksByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 100
): Promise<Array<Doc<"tasks">>> {
  return await db
    .query("tasks")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .take(limit);
}

export async function listRootTasksByProject(
  db: DatabaseReader,
  projectId: Id<"projects">,
  limit = 100
): Promise<Array<Doc<"tasks">>> {
  const tasks = await listTasksByProject(db, projectId, limit);
  return tasks.filter((t) => !t.parentTaskId);
}

export async function listSubtasks(
  db: DatabaseReader,
  parentTaskId: Id<"tasks">
): Promise<Array<Doc<"tasks">>> {
  return await db
    .query("tasks")
    .withIndex("by_parent", (q) => q.eq("parentTaskId", parentTaskId))
    .collect();
}

export async function listTasksByStatus(
  db: DatabaseReader,
  projectId: Id<"projects">,
  status: TaskStatus,
  limit = 100
): Promise<Array<Doc<"tasks">>> {
  const tasks = await listTasksByProject(db, projectId, limit);
  return tasks.filter((t) => t.status === status);
}

export async function listTasksByAssignee(
  db: DatabaseReader,
  projectId: Id<"projects">,
  assigneeId: Id<"users">,
  limit = 100
): Promise<Array<Doc<"tasks">>> {
  const tasks = await listTasksByProject(db, projectId, limit);
  return tasks.filter((t) => t.assigneeIds.includes(assigneeId));
}

export async function assignTask(
  db: DatabaseWriter,
  taskId: Id<"tasks">,
  assigneeIds: Array<Id<"users">>
): Promise<void> {
  await updateTask(db, taskId, { assigneeIds });
}

export async function deleteTask(
  db: DatabaseWriter,
  taskId: Id<"tasks">
): Promise<void> {
  await db.delete(taskId);
}

/**
 * Get the next sort order for a new task in a project
 */
export async function getNextTaskSortOrder(
  db: DatabaseReader,
  projectId: Id<"projects">
): Promise<number> {
  const tasks = await listTasksByProject(db, projectId);
  if (tasks.length === 0) return 0;
  return Math.max(...tasks.map((t) => t.sortOrder)) + 1;
}
