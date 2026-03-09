import { error, json, type RequestHandler } from '@sveltejs/kit';

// import { getAnimesByID } from 'src/malAPI';

export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  return json({
    main_picture: {
      medium: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",  // URL to the medium-sized image
    },
    start_date: "2023-01-01",  // The start date of the anime
    end_date: "2023-06-01",    // The end date of the anime, or null/undefined if ongoing
    synopsis: "This is a brief summary of the anime plot...",  // A brief description of the anime
    // Additional properties may exist depending on the API, but these are the core ones used in your template
  });
  if (!id) {
    error(400, 'Missing id param');
  }
  if (isNaN(+id)) {
    error(400, 'Invalid id param');
  }
  // console.log('test', getAnimesByID([+id]));
  try {
    const [anime] = await getAnimesByID([+id]);
    if (anime) {
      return json(anime);
    }
    error(404, 'Anime not found');
  } catch (err) {
    console.error('Error getting anime: ', err);
    error(500, 'Unable to fetch anime due to internal error');
  }
};
