import Dexie, { type Table } from 'dexie'
import type { Project } from '../types'

class VarStudioDB extends Dexie {
  projects!: Table<Project, string>

  constructor() {
    super('var-studio')
    this.version(1).stores({ projects: 'id, updatedAt' })
  }
}

export const db = new VarStudioDB()

export async function saveProject(project: Project) {
  await db.projects.put({ ...project, updatedAt: Date.now() })
}

export async function loadProjects() {
  return db.projects.orderBy('updatedAt').reverse().toArray()
}
