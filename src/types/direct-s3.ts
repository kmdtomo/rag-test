export interface DirectS3FileItem {
  key: string;
  name: string;
  size: number;
  uploadedAt: string;
  syncStatus: string;
}

export interface DirectS3Source {
  content?: string;
  uri?: string;
  type: 'direct_s3';
  title: string;
  citationNumber: number;
  metadata?: {
    fileSize?: number;
    bucket?: string;
    key?: string;
    uploadedAt?: string;
  };
}

export interface DirectS3ChatRequest {
  message: string;
  fileKey: string;
  fileName?: string;
  sessionId?: string;
}

export interface DirectS3ChatResponse {
  content: string;
  sources: DirectS3Source[];
  sessionId: string;
  processLog: string[];
  metadata: {
    modelId: string;
    fileKey: string;
    fileName?: string;
    processingTime: number;
  };
}