export namespace main {
	
	export class PlaybackInfo {
	    time_pos: number;
	    duration: number;
	    paused: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PlaybackInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time_pos = source["time_pos"];
	        this.duration = source["duration"];
	        this.paused = source["paused"];
	    }
	}

}

