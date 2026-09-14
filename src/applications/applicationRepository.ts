import type { Application } from "./applicationModel.ts";

export class ApplicationRepository {
  private applicationsById: Map<string, Application> = new Map();

  add(application: Application): Application {
    this.applicationsById.set(application.id, application);
    return application;
  }

  findById(id: string): Application | undefined {
    return this.applicationsById.get(id);
  }
}
