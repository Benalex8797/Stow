export class MilestoneProgressDto {
  milestone_id: string;
  milestone_type: string;
  name: string;
  description: string;
  threshold: number;
  current_value: number;
  progress_percentage: number;
  is_earned: boolean;
  earned_at?: Date;
  rarity_tier: number;
  is_soulbound: boolean;
}

export class UserMilestonesResponseDto {
  total_milestones: number;
  earned_count: number;
  in_progress: MilestoneProgressDto[];
  completed: MilestoneProgressDto[];
}
