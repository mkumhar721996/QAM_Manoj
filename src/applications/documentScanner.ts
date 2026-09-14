export type ScanResult = "clean" | "infected";

export interface DocumentScanner {
  scan(fileName: string, contentBase64: string): Promise<ScanResult>;
}

// Placeholder until a real AV integration exists; always reports clean.
export class NullDocumentScanner implements DocumentScanner {
  async scan(): Promise<ScanResult> {
    return "clean";
  }
}

// Deterministic test double: results keyed by file name.
export class FakeDocumentScanner implements DocumentScanner {
  private results: Record<string, ScanResult>;

  constructor(results: Record<string, ScanResult>) {
    this.results = results;
  }

  async scan(fileName: string): Promise<ScanResult> {
    return this.results[fileName] ?? "clean";
  }
}
