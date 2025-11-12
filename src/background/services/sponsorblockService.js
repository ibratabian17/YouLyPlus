// ==================================================================================================
// EXTERNAL SERVICE - SPONSORBLOCK
// ==================================================================================================

export class SponsorBlockService {
  static async fetch(videoId) {
    const categories = [
      "sponsor", "selfpromo", "interaction", "intro",
      "outro", "preview", "filler", "music_offtopic"
    ];
    
    const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=[${categories.map(c => `"${c}"`).join(',')}]`;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          console.log(`No SponsorBlock segments for videoId: ${videoId}`);
          return [];
        }
        throw new Error(`SponsorBlock API error: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error("SponsorBlock error:", error);
      return [];
    }
  }
}
