export class CredentialDocumentRepository {
  private applicationIds: string[] = [];

  add(applicationId: string): void {
    this.applicationIds.push(applicationId);
  }

  countByApplicationId(applicationId: string): number {
    return this.applicationIds.filter((id) => id === applicationId).length;
  }
}
