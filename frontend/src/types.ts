export type PageTabType = 'debug' | 'changelog' | 'preferences' | 'manageprofiles';
export type TabType = 'video' | 'playlist' | PageTabType;

export interface Tab {
    id: string;
    type: TabType;
    title: string;
    path?: string;
}

export interface PlaylistState {
    items: string[];
    selectedIndex: number;
    currentIndex: number;
    random: boolean;
    videoTabId: string | null;
    playedIndices: number[];
}

export type PlaylistsMap = Record<string, PlaylistState>;
export type TabsStateMap = Record<string, boolean>;

export interface SeekThumbs {
    vtt: string;
    spritesheetBase64: string;
}

export interface NotificationEntry {
    type: 'prompt' | 'generating' | 'done';
    message: string;
}

export interface ClosedTabEntry {
    type: TabType;
    path?: string;
    playlistItems?: string[];
}

export interface LogEntry {
    id: string;
    time: string;
    source: string;
    message: string;
}
