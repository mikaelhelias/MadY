# Written for these tests: gene x sample heatmap with geom_tile and a diverging gradient
library(ggplot2)
long <- read.csv("expression_long.csv")   # columns: gene, sample, z
ggplot(long, aes(x = sample, y = gene, fill = z)) +
  geom_tile(colour = "white") +
  scale_fill_gradient2(low = "#2166ac", mid = "white", high = "#b2182b", midpoint = 0, limits = c(-3, 3)) +
  coord_fixed() +
  labs(x = NULL, y = NULL, fill = "z-score") +
  theme_minimal() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1), panel.grid = element_blank())
