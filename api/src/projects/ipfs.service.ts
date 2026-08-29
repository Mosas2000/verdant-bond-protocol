import { Injectable } from '@nestjs/common';
import { IpfsUploadPolicy } from './ipfs-upload.policy';

interface IpfsUploadResult {
  hash: string;
  gatewayUrl: string;
  pinSize: number;
  timestamp: string;
}

@Injectable()
export class IpfsService {
  private config = {
    apiUrl: process.env.IPFS_API_URL || 'https://api.pinata.cloud',
    apiKey: process.env.IPFS_API_KEY || '',
    secretKey: process.env.IPFS_SECRET_KEY || '',
    gateway: process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/',
  };

  constructor(private readonly uploadPolicy: IpfsUploadPolicy) {}

  async uploadJson(data: Record<string, unknown>): Promise<IpfsUploadResult> {
    const response = await fetch(
      `${this.config.apiUrl}/pinning/pinJSONToIPFS`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          pinata_api_key: this.config.apiKey,
          pinata_secret_api_key: this.config.secretKey,
        },
        body: JSON.stringify({
          pinataContent: data,
          pinataMetadata: { name: `nbs-${Date.now()}` },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      hash: result.IpfsHash,
      gatewayUrl: `${this.config.gateway}${result.IpfsHash}`,
      pinSize: result.PinSize,
      timestamp: new Date().toISOString(),
    };
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimetype?: string,
  ): Promise<IpfsUploadResult> {
    await this.uploadPolicy.validate({
      buffer,
      filename,
      mimetype: mimetype ?? '',
    });
    return this.uploadJson({
      filename,
      content: buffer.toString('base64'),
      size: buffer.length,
      mimetype: mimetype ?? 'application/octet-stream',
    });
  }

  async getContent(hash: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.config.gateway}${hash}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch IPFS content: ${response.statusText}`);
    }
    return response.json();
  }

  async pin(hash: string): Promise<void> {
    const response = await fetch(
      `${this.config.apiUrl}/pinning/pinByHash`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          pinata_api_key: this.config.apiKey,
          pinata_secret_api_key: this.config.secretKey,
        },
        body: JSON.stringify({ hashToPin: hash }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to pin hash: ${response.statusText}`);
    }
  }
}
