import { queryOptions } from "@tanstack/react-query";
import { getAccessHistory, getWellbeingSeries } from "./mock-service";

export const wellbeingQuery = queryOptions({ queryKey: ["sentinel", "wellbeing-series"], queryFn: getWellbeingSeries });
export const accessHistoryQuery = queryOptions({ queryKey: ["sentinel", "access-history"], queryFn: getAccessHistory });