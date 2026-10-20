/**
 * NFT metadata following OpenSea/Stellar NFT standards.
 * This is serialized to JSON and stored on IPFS.
 */
export class NftMetadataDto {
  name: string;
  description: string;
  image: string; // IPFS URL or gateway URL
  external_url?: string; // Link to achievement on platform
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
  properties?: {
    category: 'Stow Milestone';
    milestone_type: string;
    rarity: string;
  };
}

export class GenerateNftMetadataDto {
  user_address: string;
  milestone_name: string;
  milestone_type: string;
  image_ipfs_cid: string;
  earned_date: Date;
  rarity_tier: number;
  is_soulbound: boolean;
}
