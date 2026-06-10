export type PageTabType = 'debug' | 'changelog' | 'preferences' | 'manageprofiles';
export type TabType = 'video' | 'playlist' | 'fileexplorer' | PageTabType;

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
    explorerPath?: string;
}

export type FileExplorerViewType = 'details' | 'list' | 'grid';
export type FileExplorerSortBy = 'name' | 'size' | 'dateModified' | 'dateCreated' | 'type' | 'duration';

export interface FileExplorerState {
    currentPath: string;
    history: string[];
    forwardHistory: string[];
    viewType: FileExplorerViewType;
    gridSize: number;
    sortBy: FileExplorerSortBy;
    sortDir: 'asc' | 'desc';
    selectedPath: string | null;
    videoTabId: string | null;
    playingPath: string | null;
}

export type FileExplorersMap = Record<string, FileExplorerState>;

export interface LogEntry {
    id: string;
    time: string;
    source: string;
    message: string;
}
