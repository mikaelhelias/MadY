# ggplot2 reference: geom_boxplot — continuous x binned with cut_width
ggplot(diamonds, aes(carat, price)) +
  geom_boxplot(aes(group = cut_width(carat, 0.25)), outlier.alpha = 0.1)
