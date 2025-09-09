export const cfg = {
  openaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
  openaiKey: process.env.AZURE_OPENAI_API_KEY,
  openaiDeployment: process.env.AZURE_OPENAI_DEPLOYMENT,

  searchEndpoint: process.env.AZURE_SEARCH_ENDPOINT,
  searchKey: process.env.AZURE_SEARCH_KEY,
  searchIndex: process.env.AZURE_SEARCH_INDEX,

  emrBaseUrl: process.env.EMR_BASE_URL,
  emrClientId: process.env.EMR_CLIENT_ID,
  emrClientSecret: process.env.EMR_CLIENT_SECRET
};
