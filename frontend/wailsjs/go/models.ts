export namespace main {
	
	export class PlaybackInfo {
	    time_pos: number;
	    duration: number;
	    paused: boolean;
	    volume: number;
	
	    static createFrom(source: any = {}) {
	        return new PlaybackInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time_pos = source["time_pos"];
	        this.duration = source["duration"];
	        this.paused = source["paused"];
	        this.volume = source["volume"];
	    }
	}
	export class RecentEntry {
	    path: string;
	    filename: string;
	    openedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new RecentEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.filename = source["filename"];
	        this.openedAt = source["openedAt"];
	    }
	}

}

