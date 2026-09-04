export type OcrValidationStatus = 'valid' | 'warning' | 'invalid';
export type OcrQualityStatus = 'good' | 'acceptable' | 'poor';

export type OcrFieldName = 'branchName' | 'customerAddress';

export type OcrFieldResult = {
  raw: string;
  value: string;
  confidence: number;
  validationStatus: OcrValidationStatus;
  warnings: string[];
  alternatives: string[];
};

export type OcrQualityResult = {
  status: OcrQualityStatus;
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  blurScore: number;
  glareRatio: number;
  darkRatio: number;
  warnings: string[];
};

export type BrowserOcrProgress = {
  stage: 'quality' | 'model' | 'recognition' | 'validation';
  progress: number;
  message: string;
};

export type BrowserOcrResult = {
  engine: 'browser-tesseract-kor-eng';
  status: 'succeeded' | 'failed';
  text: string;
  confidence: number;
  quality: OcrQualityResult;
  fields: Record<OcrFieldName, OcrFieldResult>;
  requiresReview: boolean;
  errorMessage?: string;
};
