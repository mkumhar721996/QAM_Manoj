export class PlatformSettingsRepository {
  private taxRatePercent: number | undefined;

  getTaxRatePercent(): number | undefined {
    return this.taxRatePercent;
  }

  setTaxRatePercent(rate: number | undefined): void {
    this.taxRatePercent = rate;
  }
}
