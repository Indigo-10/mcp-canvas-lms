declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    text: string;
    version: string;
  }

  interface PDFOptions {
    pagerender?: (pageData: unknown) => Promise<string>;
    max?: number;
    version?: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;
  export = pdfParse;
}

declare module 'officeparser' {
  interface OfficeParserConfig {
    newlineDelimiter?: string;
    ignoreNotes?: boolean;
    putNotesAtLast?: boolean;
    outputEncoding?: string;
  }

  export function parseOfficeAsync(
    buffer: Buffer | string,
    config?: OfficeParserConfig
  ): Promise<string>;
}
