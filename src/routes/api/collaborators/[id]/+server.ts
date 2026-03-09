import { json, error, type RequestHandler } from '@sveltejs/kit';
import { loadCollaborators } from 'src/embedding';

export const GET: RequestHandler = async ({ params }) => {
  const id = parseInt(params.id || '', 10);
  
  if (isNaN(id)) {
    error(400, 'Invalid author ID');
  }
  
  const collaboratorsDict = await loadCollaborators();
  const collaborators = collaboratorsDict[id] || [];
  
  return json({ 
    id, 
    collaborators,
    count: collaborators.length 
  });
};

