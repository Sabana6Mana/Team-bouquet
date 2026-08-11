/**
 * Supabase public schema used by the MVP.
 *
 * Keep this file in sync with `supabase/migrations`. Once the project is linked
 * to Supabase it can be replaced with the output of `supabase gen types`.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type SportCode = 'tennis' | 'badminton' | 'tabletennis' | 'basketball'
export type MatchModeCode = '1v1' | '2v2' | '3v3'
export type MatchPhaseCode =
  | 'queue'
  | 'scheduling'
  | 'teaming'
  | 'payment'
  | 'confirmed'
  | 'reporting'
  | 'done'
  | 'canceled'
export type QueueStatus = 'waiting' | 'matched' | 'canceled'
export type SlotStatus = 'open' | 'held' | 'booked' | 'canceled'
export type TeamSide = 'a' | 'b'
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed'
export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary'
export type HonorTypeCode = 'manner' | 'skill' | 'punctual' | 'fun'

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          nickname: string
          avatar_url: string | null
          interests: SportCode[]
          equipped_title_code: string | null
          onboarding_completed_at: string | null
          honor_total: number
          honor_manner: number
          honor_skill: number
          honor_punctual: number
          honor_fun: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          nickname: string
          avatar_url?: string | null
          interests?: SportCode[]
          equipped_title_code?: string | null
          onboarding_completed_at?: string | null
          honor_total?: number
          honor_manner?: number
          honor_skill?: number
          honor_punctual?: number
          honor_fun?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          nickname?: string
          avatar_url?: string | null
          interests?: SportCode[]
          equipped_title_code?: string | null
          onboarding_completed_at?: string | null
          honor_total?: number
          honor_manner?: number
          honor_skill?: number
          honor_punctual?: number
          honor_fun?: number
          updated_at?: string
        }
        Relationships: []
      }
      player_ratings: {
        Row: {
          profile_id: string
          sport: SportCode
          rating: number
          wins: number
          losses: number
          played: number
          current_streak: number
          best_streak: number
          updated_at: string
        }
        Insert: {
          profile_id: string
          sport: SportCode
          rating?: number
          wins?: number
          losses?: number
          played?: number
          current_streak?: number
          best_streak?: number
          updated_at?: string
        }
        Update: {
          rating?: number
          wins?: number
          losses?: number
          played?: number
          current_streak?: number
          best_streak?: number
          updated_at?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          id: string
          name: string
          sports: SportCode[]
          address: string
          lat: number
          lng: number
          price_per_hour: number
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          name: string
          sports: SportCode[]
          address: string
          lat: number
          lng: number
          price_per_hour: number
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          sports?: SportCode[]
          address?: string
          lat?: number
          lng?: number
          price_per_hour?: number
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      venue_slots: {
        Row: {
          id: string
          venue_id: string
          starts_at: string
          ends_at: string
          status: SlotStatus
          price: number | null
          reserved_match_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          venue_id: string
          starts_at: string
          ends_at: string
          status?: SlotStatus
          price?: number | null
          reserved_match_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          starts_at?: string
          ends_at?: string
          status?: SlotStatus
          price?: number | null
          reserved_match_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      queue_entries: {
        Row: {
          id: string
          user_id: string
          sport: SportCode
          mode: MatchModeCode
          capacity: number
          venue_id: string | null
          quick: boolean
          lat: number | null
          lng: number | null
          status: QueueStatus
          match_id: string | null
          created_at: string
          updated_at: string
          matched_at: string | null
          canceled_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          sport: SportCode
          mode: MatchModeCode
          capacity: number
          venue_id?: string | null
          quick?: boolean
          lat?: number | null
          lng?: number | null
          status?: QueueStatus
          match_id?: string | null
          created_at?: string
          updated_at?: string
          matched_at?: string | null
          canceled_at?: string | null
        }
        Update: {
          status?: QueueStatus
          match_id?: string | null
          updated_at?: string
          matched_at?: string | null
          canceled_at?: string | null
        }
        Relationships: []
      }
      matches: {
        Row: {
          id: string
          venue_id: string
          sport: SportCode
          mode: MatchModeCode
          capacity: number
          host_id: string
          phase: MatchPhaseCode
          quick: boolean
          confirmed_slot_id: string | null
          winner_team: TeamSide | null
          score: string | null
          finalized_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          venue_id: string
          sport: SportCode
          mode: MatchModeCode
          capacity: number
          host_id: string
          phase?: MatchPhaseCode
          quick?: boolean
          confirmed_slot_id?: string | null
          winner_team?: TeamSide | null
          score?: string | null
          finalized_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          venue_id?: string | null
          phase?: MatchPhaseCode
          confirmed_slot_id?: string | null
          winner_team?: TeamSide | null
          score?: string | null
          finalized_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      match_members: {
        Row: {
          match_id: string
          user_id: string
          team: TeamSide
          is_host: boolean
          ready: boolean
          paid: boolean
          rating_before: number | null
          rating_delta: number | null
          rating_after: number | null
          completed_at: string | null
          joined_at: string
          updated_at: string
        }
        Insert: {
          match_id: string
          user_id: string
          team: TeamSide
          is_host?: boolean
          ready?: boolean
          paid?: boolean
          rating_before?: number | null
          rating_delta?: number | null
          rating_after?: number | null
          completed_at?: string | null
          joined_at?: string
          updated_at?: string
        }
        Update: {
          team?: TeamSide
          ready?: boolean
          paid?: boolean
          rating_delta?: number | null
          rating_after?: number | null
          completed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          id: string
          match_id: string
          sender_id: string | null
          body: string
          system: boolean
          created_at: string
        }
        Insert: {
          id?: string
          match_id: string
          sender_id?: string | null
          body: string
          system?: boolean
          created_at?: string
        }
        Update: {
          body?: string
        }
        Relationships: []
      }
      slot_votes: {
        Row: {
          match_id: string
          user_id: string
          venue_slot_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          match_id: string
          user_id: string
          venue_slot_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          venue_slot_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      result_votes: {
        Row: {
          match_id: string
          user_id: string
          winner_team: TeamSide
          score: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          match_id: string
          user_id: string
          winner_team: TeamSide
          score?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          winner_team?: TeamSide
          score?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          title: string
          body: string
          link: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          body: string
          link?: string | null
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read_at?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          id: string
          reporter_id: string
          reported_id: string
          match_id: string
          reason: string
          details: string | null
          status: ReportStatus
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          reporter_id: string
          reported_id: string
          match_id: string
          reason: string
          details?: string | null
          status?: ReportStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: ReportStatus
          updated_at?: string
        }
        Relationships: []
      }
      match_honors: {
        Row: {
          id: string
          match_id: string
          giver_id: string
          receiver_id: string
          honor_type: HonorTypeCode
          created_at: string
        }
        Insert: {
          id?: string
          match_id: string
          giver_id: string
          receiver_id: string
          honor_type: HonorTypeCode
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      rating_events: {
        Row: {
          id: string
          profile_id: string
          match_id: string
          sport: SportCode
          rating_before: number
          delta: number
          rating_after: number
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          match_id: string
          sport: SportCode
          rating_before: number
          delta: number
          rating_after: number
          created_at?: string
        }
        Update: never
        Relationships: []
      }
      achievement_definitions: {
        Row: {
          code: string
          name: string
          description: string
          icon: string
          metric_code: string
          target: number
          title_name: string
          rarity: AchievementRarity
          sort_order: number
          active: boolean
          hidden: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          code: string
          name: string
          description: string
          icon: string
          metric_code: string
          target: number
          title_name: string
          rarity: AchievementRarity
          sort_order?: number
          active?: boolean
          hidden?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string
          icon?: string
          metric_code?: string
          target?: number
          title_name?: string
          rarity?: AchievementRarity
          sort_order?: number
          active?: boolean
          hidden?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      player_achievements: {
        Row: {
          profile_id: string
          achievement_code: string
          progress: number
          unlocked_at: string | null
          unlocked_match_id: string | null
          notified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          achievement_code: string
          progress?: number
          unlocked_at?: string | null
          unlocked_match_id?: string | null
          notified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          progress?: number
          unlocked_at?: string | null
          unlocked_match_id?: string | null
          notified_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      join_match_queue: {
        Args: {
          p_sport: SportCode
          p_mode: MatchModeCode
          p_venue_id?: string | null
          p_lat?: number | null
          p_lng?: number | null
        }
        Returns: Json
      }
      cancel_match_queue: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      vote_match_slot: {
        Args: {
          p_match_id: string
          p_venue_slot_id: string
        }
        Returns: Json
      }
      vote_match_result: {
        Args: {
          p_match_id: string
          p_winner_team: TeamSide
          p_score: string
        }
        Returns: Json
      }
      set_match_teams: {
        Args: {
          p_match_id: string
          p_team_a: string[]
          p_team_b: string[]
        }
        Returns: Json
      }
      set_match_ready: {
        Args: {
          p_match_id: string
          p_ready: boolean
        }
        Returns: Json
      }
      confirm_match_attendance: {
        Args: {
          p_match_id: string
        }
        Returns: Json
      }
      open_match_reporting: {
        Args: {
          p_match_id: string
        }
        Returns: Json
      }
      complete_match: {
        Args: {
          p_match_id: string
        }
        Returns: Json
      }
      get_my_achievements: {
        Args: Record<PropertyKey, never>
        Returns: {
          code: string
          name: string
          description: string
          icon: string
          reward_title: string
          rarity: AchievementRarity
          target: number
          progress: number
          unlocked_at: string | null
          equipped: boolean
        }[]
      }
      equip_my_title: {
        Args: {
          p_achievement_code: string | null
        }
        Returns: string | null
      }
      is_nickname_available: {
        Args: {
          p_nickname: string
        }
        Returns: boolean
      }
      save_my_profile: {
        Args: {
          p_nickname: string
          p_interests: SportCode[]
          p_avatar_url?: string | null
        }
        Returns: Database['public']['Tables']['profiles']['Row']
      }
      give_match_honor: {
        Args: {
          p_match_id: string
          p_receiver_id: string
          p_honor_type: HonorTypeCode
        }
        Returns: Json
      }
    }
    Enums: {
      sport_code: SportCode
      match_mode: MatchModeCode
      match_phase: MatchPhaseCode
      queue_status: QueueStatus
      slot_status: SlotStatus
      team_side: TeamSide
      report_status: ReportStatus
      honor_type: HonorTypeCode
    }
    CompositeTypes: Record<string, never>
  }
}

type PublicTables = Database['public']['Tables']

export type TableName = keyof PublicTables
export type TableRow<Name extends TableName> = PublicTables[Name]['Row']
export type TableInsert<Name extends TableName> = PublicTables[Name]['Insert']
export type TableUpdate<Name extends TableName> = PublicTables[Name]['Update']
