# ggplot2 reference: geom_violin — log y via scale
m <- ggplot(movies, aes(y = votes, x = rating, group = cut_width(rating, 0.5)))
m +
  geom_violin() +
  scale_y_log10()
