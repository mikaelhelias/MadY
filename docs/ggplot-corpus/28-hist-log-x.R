# ggplot2 reference: geom_histogram — log10 x scale
m <- ggplot(movies, aes(rating))
m +
  geom_histogram(binwidth = 0.05) +
  scale_x_log10()
