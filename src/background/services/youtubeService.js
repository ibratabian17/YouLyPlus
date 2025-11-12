// ==================================================================================================
// EXTERNAL SERVICE - YOUTUBE
// ==================================================================================================

import { DataParser } from '../utils/dataParser.js';

export class YouTubeService {
  static async fetchSubtitles(songInfo) {
    try {
      const subtitleInfo = songInfo.subtitle;
      if (!subtitleInfo?.captionTracks?.length) return null;

      const validTracks = subtitleInfo.captionTracks.filter(
        t => t.kind !== 'asr' && !t.vssId?.startsWith('a.')
      );
      
      const selectedTrack = validTracks.find(t => t.isDefault) || validTracks[0];
      if (!selectedTrack) return null;

      const url = new URL(selectedTrack.baseUrl || selectedTrack.url);
      url.searchParams.set('fmt', 'json3');

      const response = await fetch(url.toString());
      if (!response.ok) return null;

      const data = await response.json();
      return DataParser.parseYouTubeSubtitles(data, songInfo);
    } catch (error) {
      console.error("YouTube subtitles error:", error);
      return null;
    }
  }
}
