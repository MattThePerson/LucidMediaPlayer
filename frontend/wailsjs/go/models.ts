export namespace db {
	
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

export namespace main {
	
	export class FileEntry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    dateModified: string;
	    dateCreated: string;
	    extension: string;
	    isMedia: boolean;
	    hasSeekThumbs: boolean;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.dateModified = source["dateModified"];
	        this.dateCreated = source["dateCreated"];
	        this.extension = source["extension"];
	        this.isMedia = source["isMedia"];
	        this.hasSeekThumbs = source["hasSeekThumbs"];
	        this.duration = source["duration"];
	    }
	}
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
	export class Preferences {
	    autogenerateSeekThumbs: boolean;
	    openInExistingInstance: boolean;
	    clickToTogglePlayback: boolean;
	    oneVideoAtATime: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Preferences(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.autogenerateSeekThumbs = source["autogenerateSeekThumbs"];
	        this.openInExistingInstance = source["openInExistingInstance"];
	        this.clickToTogglePlayback = source["clickToTogglePlayback"];
	        this.oneVideoAtATime = source["oneVideoAtATime"];
	    }
	}
	export class ProfileEntry {
	    id: string;
	    name: string;
	    color: string;
	
	    static createFrom(source: any = {}) {
	        return new ProfileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	    }
	}
	export class ProfileInfo {
	    id: string;
	    name: string;
	    color: string;
	
	    static createFrom(source: any = {}) {
	        return new ProfileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	    }
	}
	export class TrackInfo {
	    id: number;
	    type: string;
	    title: string;
	    lang: string;
	    codec: string;
	    selected: boolean;
	    external: boolean;
	    externalFilename: string;
	
	    static createFrom(source: any = {}) {
	        return new TrackInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.title = source["title"];
	        this.lang = source["lang"];
	        this.codec = source["codec"];
	        this.selected = source["selected"];
	        this.external = source["external"];
	        this.externalFilename = source["externalFilename"];
	    }
	}
	export class SubtitleState {
	    tracks: TrackInfo[];
	    activeSid: number;
	
	    static createFrom(source: any = {}) {
	        return new SubtitleState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tracks = this.convertValues(source["tracks"], TrackInfo);
	        this.activeSid = source["activeSid"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace thumbs {
	
	export class SeekThumbnailData {
	    vtt: string;
	    spritesheetBase64: string;
	    ready: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SeekThumbnailData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vtt = source["vtt"];
	        this.spritesheetBase64 = source["spritesheetBase64"];
	        this.ready = source["ready"];
	    }
	}

}

