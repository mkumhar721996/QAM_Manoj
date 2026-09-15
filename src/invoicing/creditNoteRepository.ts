import type { CreditNote } from "./creditNoteModel.ts";

export class CreditNoteRepository {
  private creditNotesById: Map<string, CreditNote> = new Map();

  add(creditNote: CreditNote): void {
    this.creditNotesById.set(creditNote.id, creditNote);
  }

  findById(id: string): CreditNote | undefined {
    return this.creditNotesById.get(id);
  }
}
