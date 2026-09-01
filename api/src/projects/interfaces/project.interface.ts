export enum ProjectStatusEnum {
  Pending = 'Pending',
  Approved = 'Approved',
  Rejected = 'Rejected',
  Inactive = 'Inactive',
}

export interface ProjectResponse {
  id: number;
  name: string;
  status: ProjectStatusEnum;
  methodology: string;
  country: string;
  metadataIpfsHash: string;
  ownerAddress: string;
  totalAreaHa: number;
  carbonSequestrationEstimate: number;
  createdAt: string;
  /** Only present on the response to a just-submitted registration; absent on reads. */
  transactionHash?: string;
}

export interface DocumentUploadResponse {
  projectId: number;
  documentHashes: string[];
  gatewayUrls: string[];
}

export type ProvenanceEventType = 'registration' | 'review' | 'report' | 'bond' | 'document';

export interface ProvenanceEvent {
  type: ProvenanceEventType;
  occurredAt: string | null;
  title: string;
  status: 'complete' | 'pending' | 'stale';
  reference?: string;
  evidenceUrl?: string;
}

export interface ProjectProvenanceResponse {
  projectId: number;
  events: ProvenanceEvent[];
}
