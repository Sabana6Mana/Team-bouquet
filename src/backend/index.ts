export {
  BackendNotConfiguredError,
  backendConfig,
  requireSupabase,
  supabase,
} from './client'
export {
  BackendRequestError,
  achievementApi,
  historyApi,
  notificationApi,
  authApi,
  backendApi,
  matchApi,
  messageApi,
  profileApi,
  queueApi,
  reportApi,
  venueApi,
  voteApi,
} from './api'
export type {
  Database,
  Json,
  MatchModeCode,
  MatchPhaseCode,
  QueueStatus,
  ReportStatus,
  SlotStatus,
  SportCode,
  TableInsert,
  TableName,
  TableRow,
  TableUpdate,
  TeamSide,
} from './database.types'
export type * from './types'
export {
  currentMatchToAppMatch,
  encodedSlotsByVenueSlotId,
  isoStartToEncodedSlot,
  profileToAccount,
  profileToPlayer,
  venueSlotIdsByEncodedSlot,
} from './adapters'
