'use server';
/**
 * @fileOverview A flow to scan a license plate from an image.
 *
 * - scanPlate - A function that handles the license plate scanning.
 * - ScanPlateInput - The input type for the scanPlate function.
 * - ScanPlateOutput - The return type for the scanPlate function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ScanPlateInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a vehicle's license plate, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ScanPlateInput = z.infer<typeof ScanPlateInputSchema>;

const ScanPlateOutputSchema = z.object({
  licensePlate: z.string().describe('The license plate text extracted from the image. Should be uppercase without spaces or special characters.'),
});
export type ScanPlateOutput = z.infer<typeof ScanPlateOutputSchema>;

export async function scanPlate(input: ScanPlateInput): Promise<ScanPlateOutput> {
  return scanPlateFlow(input);
}

const prompt = ai.definePrompt({
  name: 'scanPlatePrompt',
  input: {schema: ScanPlateInputSchema},
  output: {schema: ScanPlateOutputSchema},
  prompt: `You are an expert at reading license plates from images, even if they are blurry or at an angle.
  
Analyze the following image and extract the license plate number.
  
Return only the license plate text. It should be uppercase and contain no spaces or special characters.
  
If you cannot determine the license plate, return an empty string for the licensePlate field.

Photo: {{media url=photoDataUri}}`,
});

const scanPlateFlow = ai.defineFlow(
  {
    name: 'scanPlateFlow',
    inputSchema: ScanPlateInputSchema,
    outputSchema: ScanPlateOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
