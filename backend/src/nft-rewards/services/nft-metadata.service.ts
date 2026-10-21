import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { NftMetadataDto, GenerateNftMetadataDto } from '../dto/nft-metadata.dto';

/**
 * Generates and manages NFT metadata compliant with OpenSea/Stellar standards.
 * Serializes metadata to JSON and pins to IPFS.
 */
@Injectable()
export class NftMetadataService {
  private readonly pinataApiKey: string;
  private readonly pinataSecretKey: string;
  private readonly pinataGateway: string;

  constructor(private readonly configService: ConfigService) {
    this.pinataApiKey =
      this.configService.get<string>('PINATA_API_KEY') || '';
    this.pinataSecretKey =
      this.configService.get<string>('PINATA_SECRET_KEY') || '';
    this.pinataGateway =
      this.configService.get<string>('PINATA_GATEWAY') ||
      'https://gateway.pinata.cloud/ipfs/';
  }

  /**
   * Generates NFT metadata JSON from milestone data and pins to IPFS.
   * Returns the IPFS CID.
   */
  async generateAndPinMetadata(
    params: GenerateNftMetadataDto,
  ): Promise<{ cid: string; metadata: NftMetadataDto }> {
    const rarityTierName = this.getRarityTierName(params.rarity_tier);

    const metadata: NftMetadataDto = {
      name: params.milestone_name,
      description: `Milestone achievement unlocked on Stow. ${params.is_soulbound ? 'This is a soulbound NFT and cannot be transferred.' : ''}`,
      image: `${this.pinataGateway}${params.image_ipfs_cid}`,
      external_url: `https://stow.app/achievements/${params.user_address}`,
      attributes: [
        {
          trait_type: 'Milestone Type',
          value: params.milestone_type,
        },
        {
          trait_type: 'Rarity Tier',
          value: rarityTierName,
        },
        {
          trait_type: 'Earned Date',
          value: params.earned_date.toISOString(),
        },
        {
          trait_type: 'Soulbound',
          value: params.is_soulbound ? 'Yes' : 'No',
        },
      ],
      properties: {
        category: 'Stow Milestone',
        milestone_type: params.milestone_type,
        rarity: rarityTierName,
      },
    };

    if (!this.pinataApiKey || !this.pinataSecretKey) {
      // Return mock CID for development/testing
      const mockCid = `mock_${Date.now()}`;
      return { cid: mockCid, metadata };
    }

    const cid = await this.pinToIpfs(metadata);
    return { cid, metadata };
  }

  private async pinToIpfs(metadata: NftMetadataDto): Promise<string> {
    const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

    try {
      const response = await axios.post(
        url,
        metadata,
        {
          headers: {
            'pinata_api_key': this.pinataApiKey,
            'pinata_secret_api_key': this.pinataSecretKey,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data.IpfsHash;
    } catch (error) {
      throw new Error(
        `Failed to pin metadata to IPFS: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private getRarityTierName(tier: number): string {
    const tiers: Record<number, string> = {
      1: 'Common',
      2: 'Uncommon',
      3: 'Rare',
      4: 'Epic',
      5: 'Legendary',
    };
    return tiers[tier] || 'Common';
  }

  /** Constructs IPFS gateway URL from CID */
  getMetadataUrl(cid: string): string {
    if (cid.startsWith('mock_')) {
      // Development mock
      return `ipfs://${cid}`;
    }
    return `${this.pinataGateway}${cid}`;
  }
}
