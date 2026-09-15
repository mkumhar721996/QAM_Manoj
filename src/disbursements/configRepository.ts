export class ConfigRepository {
  private serviceFeeRate: number;

  constructor(initialRate: number = 0.15) {
    this.serviceFeeRate = initialRate;
  }

  getServiceFeeRate(): number {
    return this.serviceFeeRate;
  }

  setServiceFeeRate(rate: number): void {
    this.serviceFeeRate = rate;
  }
}
