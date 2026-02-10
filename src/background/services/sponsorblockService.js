// ==================================================================================================
// EXTERNAL SERVICE - SPONSORBLOCK
// ==================================================================================================

export class SponsorBlockService {
  static async fetch(videoId) {
    const categories = [
      "sponsor", "selfpromo", "interaction", "intro",
      "outro", "preview", "filler", "music_offtopic"
    ];

    try {
      if (!videoId) return [];

      const prefix = await this.computeHashPrefix(videoId);
      const url = `https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${JSON.stringify(categories)}&actionTypes=${JSON.stringify(["skip", "mute", "full"])}`;

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new Error(`SponsorBlock API error: ${response.statusText}`);
      }

      const data = await response.json();

      const videoData = data.find(item => item.videoID === videoId);
      return videoData ? videoData.segments : [];

    } catch (error) {
      console.error("SponsorBlock error:", error);
      return [];
    }
  }

  static async computeHashPrefix(videoId) {
    const encoder = new TextEncoder();
    const data = encoder.encode(videoId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 4);
  }
}
