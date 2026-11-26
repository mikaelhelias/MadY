# Written for these tests: dose-response scatter on a log10 x axis, mean per dose, no fit
library(ggplot2)
dr <- read.csv("dose_response.csv")   # columns: conc, response, compound
ggplot(dr, aes(x = conc, y = response, colour = compound, shape = compound)) +
  geom_point(size = 2.5, alpha = 0.8) +
  stat_summary(fun = mean, geom = "line") +
  scale_x_log10(breaks = c(0.01, 0.1, 1, 10, 100, 1000)) +
  scale_colour_manual(values = c("#0072B2", "#E69F00")) +
  labs(x = "Concentration (uM)", y = "Response (% of max)", colour = NULL, shape = NULL) +
  theme_bw(base_size = 12) +
  theme(legend.position = "top", panel.grid.minor = element_blank())
