import { json } from '@sveltejs/kit';
import OpenAI from 'openai';

export async function POST({ request }) {
  try {
    const { info_a, info_b} = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json({ error: 'OPENAI_API_KEY is not set on the server' }, { status: 500 });
    }

    // Initialize the OpenAI client with environment key
    const openai = new OpenAI({
      apiKey,
    });

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a great biomed researcher and biomed dataset producer. You are also an assistant specialized in find users for a biomed dataset. Your task is to provide professional and insightful explanations on why [Dataset A's Name] should consider [Author B's Name] as a user. [Dataset A's Name] will read this response to decide whether [Author B's Name] is a good potential adpoters. All your points should be based on the given information, mostly on the expertise authors B have and the property, strength of Dataset A. Never use "Dataset A" or "Author B" or pronouns in your response. Use their names instead. You should give specific reasons for the adoption with evidence. Write your answer in plain text.`,
          },
          {
            role: 'user',
            content: `
      You are provided with information about one biomed dataset and one researcher, including their recent publications (especially highly cited ones after 2017), affiliations, total number of publications, career starting year, and their names. For the dataset, you will get some description of the dataset (sometimes not provided) and its name.
      
      **Information about Dataset A (the dataset we are considering):**
      
      ${info_a}
      
      **Information about Author B (the recommended users):**
      
      ${info_b}
      
      Provide a concise response (<100 words). Use several points: 1), 2), ..., etc. [Dataset A's Name] will read this response to decide whether [Author B's Name] can work as the user of Dataset A. Provide a professional and persuasive explanation. Remember that you should talk more about [Author B's Name]. The most important aspect is their papers. Never use specific numbers of citation counts or numbers of publications. Use evidence and all based on the information given to you. Never use "Dataset A" or "Author B" or "your" in your response. Use their names instead. Never use the word "collaboration" in your response. Avoid weak arguments like 'Collaborating could enhance the depth and breadth of knowledge for both researchers.' Be specific and professional. Always use specific reasons and evidence. Be concise but powerful. In your response, do not use clauses in the -ing form; try to express your ideas in complete sentences. For example, avoid using sentence structures like "X is blabla, providing ...."`,
          },
        ],
      });

    const explanation = completion.choices[0].message.content;

    return json({ explanation });
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    return json({ error: 'Error calling OpenAI API' }, { status: 500 });
  }
}
