import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ensureKiteHome, randomToken } from './home.js';

export type ProjectStatus = 'idle' | 'running' | 'success' | 'failed';
export type DeploymentStatus = 'running' | 'success' | 'failed';

export interface Project {
  id: string;
  name: string;
  description?: string;
  deployPath: string;
  token: string;
  preDeployScript?: string;
  postDeployScript?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentLog {
  id: string;
  projectId: string;
  projectName: string;
  status: DeploymentStatus;
  triggerSource: 'cli' | 'webhook';
  duration?: string;
  output: string;
  startTime: string;
  endTime?: string;
}

interface LocalDb {
  adminToken: string;
  projects: Project[];
  deployments: DeploymentLog[];
}

const createDefaultDb = (): LocalDb => {
  const now = new Date().toISOString();
  const home = ensureKiteHome();

  return {
    adminToken: randomToken('admin'),
    projects: [
      {
        id: 'proj_abc123',
        name: 'Kite Demo Project',
        description: 'CLI 内置服务的演示项目，可直接配合 test-token 测试上传部署。',
        deployPath: path.join(home, 'deployments', 'proj_abc123'),
        token: 'test-token',
        preDeployScript: '',
        postDeployScript: 'echo "demo deployment finished"',
        status: 'idle',
        createdAt: now,
        updatedAt: now
      }
    ],
    deployments: []
  };
};

export class LocalStore {
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(ensureKiteHome(), 'kite.db.json');
    if (!fs.existsSync(this.dbPath)) {
      this.write(createDefaultDb());
    }
  }

  get path() {
    return this.dbPath;
  }

  get home() {
    return ensureKiteHome();
  }

  read(): LocalDb {
    return JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
  }

  write(db: LocalDb) {
    fs.writeFileSync(this.dbPath, `${JSON.stringify(db, null, 2)}\n`);
  }

  getAdminToken() {
    return this.read().adminToken;
  }

  findProjects() {
    return this.read().projects;
  }

  findProjectById(id: string) {
    return this.read().projects.find(project => project.id === id) || null;
  }

  findProjectByToken(token: string) {
    return this.read().projects.find(project => project.token === token) || null;
  }

  createProject(data: Pick<Project, 'name' | 'deployPath'> & Partial<Project>) {
    const db = this.read();
    const now = new Date().toISOString();
    const project: Project = {
      id: `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: data.name,
      description: data.description,
      deployPath: data.deployPath,
      token: randomToken('kt'),
      preDeployScript: data.preDeployScript || '',
      postDeployScript: data.postDeployScript || '',
      status: 'idle',
      createdAt: now,
      updatedAt: now
    };

    db.projects.push(project);
    this.write(db);
    return project;
  }

  updateProject(id: string, data: Partial<Project>) {
    const db = this.read();
    const index = db.projects.findIndex(project => project.id === id);
    if (index < 0) return null;

    db.projects[index] = {
      ...db.projects[index],
      ...data,
      updatedAt: new Date().toISOString()
    };
    this.write(db);
    return db.projects[index];
  }

  removeProject(id: string) {
    const db = this.read();
    const before = db.projects.length;
    db.projects = db.projects.filter(project => project.id !== id);
    db.deployments = db.deployments.filter(log => log.projectId !== id);
    this.write(db);
    return db.projects.length !== before;
  }

  findDeployments() {
    return this.read().deployments.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  findDeploymentById(id: string) {
    return this.read().deployments.find(log => log.id === id) || null;
  }

  createDeployment(data: Omit<DeploymentLog, 'id'>) {
    const db = this.read();
    const log: DeploymentLog = {
      ...data,
      id: crypto.randomUUID()
    };
    db.deployments.push(log);
    this.write(db);
    return log;
  }

  updateDeployment(id: string, data: Partial<DeploymentLog>) {
    const db = this.read();
    const index = db.deployments.findIndex(log => log.id === id);
    if (index < 0) return null;

    db.deployments[index] = {
      ...db.deployments[index],
      ...data
    };
    this.write(db);
    return db.deployments[index];
  }
}
