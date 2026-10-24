import { type HealthResponse, healthResponseSchema } from '@jottape/schemas';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export function useApiHealth() {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: async () => healthResponseSchema.parse(await api.get('health').json()),
  });
}
